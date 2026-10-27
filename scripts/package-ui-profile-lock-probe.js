const PACKAGE_UI_PROFILE_LOCK_PROBE_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class PackageUiProfileLockProbe
{
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_LIST_DIRECTORY = 0x00000001;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public FILETIME CreationTime;
        public FILETIME LastAccessTime;
        public FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle file,
        out BY_HANDLE_FILE_INFORMATION information);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(
        SafeFileHandle file,
        StringBuilder path,
        uint pathLength,
        uint flags);

    private sealed class ProbeException : Exception
    {
        public string Code;
        public string PathHash;
        public int NativeCode;

        public ProbeException(string code, string path, int nativeCode)
            : base(code)
        {
            Code = code;
            PathHash = Hash(path ?? String.Empty);
            NativeCode = nativeCode;
        }
    }

    private sealed class Entry
    {
        public string FullPath;
        public string RelativePath;
        public string Kind;
        public string Identity;
        public string PathHash;
        public uint LinkCount;
        public long SizeBytes;
    }

    private sealed class Held
    {
        public SafeFileHandle Handle;
        public string PathHash;
    }

    public sealed class CriticalEntry
    {
        public string identitySha256;
        public string kind;
        public uint linkCount;
        public string pathSha256;
        public long sizeBytes;
    }

    public sealed class CloseFailure
    {
        public int nativeCode;
        public string pathSha256;
    }

    public sealed class Result
    {
        public bool allEntriesHeld;
        public int closeFailureCount;
        public List<CloseFailure> closeFailures;
        public int criticalEntryCount;
        public List<CriticalEntry> criticalEntries;
        public int directoryCount;
        public int entryCount;
        public string errorCode;
        public int errorNativeCode;
        public string errorPathSha256;
        public int fileCount;
        public int heldHandleCount;
        public string identitySetSha256;
        public int maxCriticalEntries;
        public int maxDurationMilliseconds;
        public int maxEntries;
        public int maxPathCharacters;
        public string method;
        public bool passed;
        public string pathSetSha256;
        public string rootPathSha256;
        public int secondSnapshotEntryCount;
        public int totalPathCharacters;
        public bool treeStable;
    }

    private static string Hash(string value)
    {
        using (SHA256 sha = SHA256.Create())
        {
            byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? String.Empty));
            return BitConverter.ToString(bytes).Replace("-", String.Empty);
        }
    }

    private static string CanonicalPath(string value)
    {
        string full = Path.GetFullPath(value);
        if (full.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
            return @"\\" + full.Substring(8);
        if (full.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
            return full.Substring(4);
        return full;
    }

    private static void EnforceDeadline(long deadlineTimestamp, string path)
    {
        if (Stopwatch.GetTimestamp() > deadlineTimestamp)
            throw new ProbeException("ENUMERATION_DEADLINE_EXCEEDED", path, 0);
    }

    private static string FinalPath(SafeFileHandle handle)
    {
        StringBuilder buffer = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0 || length >= buffer.Capacity)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return CanonicalPath(buffer.ToString());
    }

    private static Entry Inspect(string root, string fullPath, string kind, uint shareMode)
    {
        uint desired = kind == "directory"
            ? FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES
            : GENERIC_READ | FILE_READ_ATTRIBUTES;
        uint flags = FILE_FLAG_OPEN_REPARSE_POINT
            | (kind == "directory" ? FILE_FLAG_BACKUP_SEMANTICS : 0);
        SafeFileHandle handle = CreateFileW(
            fullPath,
            desired,
            shareMode,
            IntPtr.Zero,
            OPEN_EXISTING,
            flags,
            IntPtr.Zero);
        if (handle == null || handle.IsInvalid)
        {
            int code = Marshal.GetLastWin32Error();
            if (handle != null) handle.Dispose();
            throw new ProbeException(
                shareMode == 0 ? "EXCLUSIVE_OPEN_FAILED" : "IDENTITY_OPEN_FAILED",
                fullPath,
                code);
        }
        try
        {
            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(handle, out info))
                throw new ProbeException("IDENTITY_QUERY_FAILED", fullPath, Marshal.GetLastWin32Error());
            if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                throw new ProbeException("REPARSE_POINT", fullPath, 0);
            if (!String.Equals(FinalPath(handle), CanonicalPath(fullPath), StringComparison.OrdinalIgnoreCase))
                throw new ProbeException("FINAL_PATH_CHANGED", fullPath, 0);
            long size = ((long)info.FileSizeHigh << 32) | info.FileSizeLow;
            string identity = info.VolumeSerialNumber.ToString("X8")
                + ":" + info.FileIndexHigh.ToString("X8")
                + info.FileIndexLow.ToString("X8")
                + ":" + info.NumberOfLinks.ToString()
                + ":" + size.ToString()
                + ":" + info.FileAttributes.ToString("X8");
            if (kind == "file" && info.NumberOfLinks != 1)
                throw new ProbeException("HARDLINKED_FILE", fullPath, 0);
            string relative = String.Equals(root, fullPath, StringComparison.OrdinalIgnoreCase)
                ? "."
                : fullPath.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar);
            return new Entry {
                FullPath = fullPath,
                RelativePath = relative.Replace(Path.DirectorySeparatorChar, '/'),
                Kind = kind,
                Identity = identity,
                PathHash = Hash(relative.Replace(Path.DirectorySeparatorChar, '/').ToLowerInvariant()),
                LinkCount = info.NumberOfLinks,
                SizeBytes = size
            };
        }
        finally
        {
            handle.Dispose();
        }
    }

    private static List<Tuple<string, string>> EnumeratePaths(
        string root,
        int maxEntries,
        int maxPathCharacters,
        long deadlineTimestamp,
        out int totalPathCharacters)
    {
        List<Tuple<string, string>> rows = new List<Tuple<string, string>>();
        HashSet<string> discovered = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Stack<string> pending = new Stack<string>();
        string prefix = root.EndsWith(Path.DirectorySeparatorChar.ToString())
            ? root
            : root + Path.DirectorySeparatorChar;
        string canonicalRoot = CanonicalPath(root);
        discovered.Add(canonicalRoot);
        pending.Push(canonicalRoot);
        totalPathCharacters = canonicalRoot.Length;
        if (maxEntries < 1)
            throw new ProbeException("ENTRY_LIMIT_EXCEEDED", root, 0);
        if (totalPathCharacters > maxPathCharacters)
            throw new ProbeException("PATH_CHARACTER_LIMIT_EXCEEDED", root, 0);
        while (pending.Count > 0)
        {
            EnforceDeadline(deadlineTimestamp, root);
            string current = pending.Pop();
            FileAttributes attributes;
            try { attributes = File.GetAttributes(current); }
            catch (Exception) { throw new ProbeException("ENUMERATION_ATTRIBUTE_FAILED", current, Marshal.GetLastWin32Error()); }
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw new ProbeException("REPARSE_POINT", current, 0);
            string kind = (attributes & FileAttributes.Directory) != 0 ? "directory" : "file";
            rows.Add(Tuple.Create(current, kind));
            if (kind == "directory")
            {
                List<string> children = new List<string>();
                try
                {
                    foreach (string rawChild in Directory.EnumerateFileSystemEntries(current))
                    {
                        EnforceDeadline(deadlineTimestamp, current);
                        string child = CanonicalPath(rawChild);
                        if (!child.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                            throw new ProbeException("PATH_ESCAPE", child, 0);
                        if (discovered.Contains(child))
                            throw new ProbeException("PATH_CASE_COLLISION", child, 0);
                        if (discovered.Count >= maxEntries)
                            throw new ProbeException("ENTRY_LIMIT_EXCEEDED", root, 0);
                        long nextPathCharacters =
                            (long)totalPathCharacters + (long)child.Length;
                        if (nextPathCharacters > maxPathCharacters)
                            throw new ProbeException("PATH_CHARACTER_LIMIT_EXCEEDED", root, 0);
                        discovered.Add(child);
                        totalPathCharacters = (int)nextPathCharacters;
                        children.Add(child);
                    }
                }
                catch (ProbeException) { throw; }
                catch (Exception) { throw new ProbeException("DIRECTORY_ENUMERATION_FAILED", current, Marshal.GetLastWin32Error()); }
                children.Sort(StringComparer.OrdinalIgnoreCase);
                for (int index = children.Count - 1; index >= 0; index -= 1)
                    pending.Push(children[index]);
            }
        }
        rows.Sort((left, right) => StringComparer.OrdinalIgnoreCase.Compare(left.Item1, right.Item1));
        return rows;
    }

    private static bool CriticalName(string fullPath)
    {
        string name = Path.GetFileName(fullPath).ToLowerInvariant();
        return name == "cookies"
            || name == "cookies-journal"
            || name == "history"
            || name == "history-journal"
            || name == "login data"
            || name == "login data-journal"
            || name == "web data"
            || name == "web data-journal"
            || name == "singletonlock"
            || name == "singletoncookie"
            || name == "singletonsocket"
            || name == "devtoolsactiveport"
            || name.EndsWith(".db")
            || name.EndsWith(".sqlite")
            || name.EndsWith(".sqlite3")
            || name.EndsWith("-wal")
            || name.EndsWith("-shm")
            || name.EndsWith("-journal")
            || name.Contains("lock");
    }

    public static Result Probe(
        string requestedRoot,
        int maxEntries,
        int maxPathCharacters,
        int maxCriticalEntries,
        int maxDurationMilliseconds)
    {
        string root = CanonicalPath(requestedRoot).TrimEnd(Path.DirectorySeparatorChar);
        long durationTicks = checked(
            (long)Math.Ceiling(
                ((double)Stopwatch.Frequency * (double)maxDurationMilliseconds)
                / 1000.0));
        long deadlineTimestamp = checked(Stopwatch.GetTimestamp() + durationTicks);
        Result result = new Result {
            allEntriesHeld = false,
            closeFailureCount = 0,
            closeFailures = new List<CloseFailure>(),
            criticalEntries = new List<CriticalEntry>(),
            errorCode = null,
            errorNativeCode = 0,
            errorPathSha256 = null,
            maxCriticalEntries = maxCriticalEntries,
            maxDurationMilliseconds = maxDurationMilliseconds,
            maxEntries = maxEntries,
            maxPathCharacters = maxPathCharacters,
            method = "win32-createfile-share-none-stable-tree/v1",
            passed = false,
            rootPathSha256 = Hash(root.Replace(Path.DirectorySeparatorChar, '/').ToLowerInvariant())
        };
        List<Held> held = new List<Held>();
        try
        {
            int firstChars;
            List<Tuple<string, string>> firstPaths = EnumeratePaths(
                root,
                maxEntries,
                maxPathCharacters,
                deadlineTimestamp,
                out firstChars);
            List<Entry> first = firstPaths
                .Select(row => Inspect(
                    root,
                    row.Item1,
                    row.Item2,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE))
                .ToList();

            foreach (Entry expected in first.Where(item => item.Kind == "file"))
            {
                uint desired = expected.Kind == "directory"
                    ? FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES
                    : GENERIC_READ | FILE_READ_ATTRIBUTES;
                uint flags = FILE_FLAG_OPEN_REPARSE_POINT
                    | (expected.Kind == "directory" ? FILE_FLAG_BACKUP_SEMANTICS : 0);
                SafeFileHandle handle = CreateFileW(
                    expected.FullPath,
                    desired,
                    0,
                    IntPtr.Zero,
                    OPEN_EXISTING,
                    flags,
                    IntPtr.Zero);
                if (handle == null || handle.IsInvalid)
                {
                    int code = Marshal.GetLastWin32Error();
                    if (handle != null) handle.Dispose();
                    throw new ProbeException("EXCLUSIVE_OPEN_FAILED", expected.FullPath, code);
                }
                BY_HANDLE_FILE_INFORMATION info;
                if (!GetFileInformationByHandle(handle, out info))
                {
                    int code = Marshal.GetLastWin32Error();
                    handle.Dispose();
                    throw new ProbeException("IDENTITY_QUERY_FAILED", expected.FullPath, code);
                }
                long size = ((long)info.FileSizeHigh << 32) | info.FileSizeLow;
                string identity = info.VolumeSerialNumber.ToString("X8")
                    + ":" + info.FileIndexHigh.ToString("X8")
                    + info.FileIndexLow.ToString("X8")
                    + ":" + info.NumberOfLinks.ToString()
                    + ":" + size.ToString()
                    + ":" + info.FileAttributes.ToString("X8");
                if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                {
                    handle.Dispose();
                    throw new ProbeException("REPARSE_POINT", expected.FullPath, 0);
                }
                if (!String.Equals(identity, expected.Identity, StringComparison.Ordinal)
                    || !String.Equals(FinalPath(handle), CanonicalPath(expected.FullPath), StringComparison.OrdinalIgnoreCase))
                {
                    handle.Dispose();
                    throw new ProbeException("IDENTITY_CHANGED", expected.FullPath, 0);
                }
                held.Add(new Held { Handle = handle, PathHash = expected.PathHash });
            }

            int secondChars;
            List<Tuple<string, string>> secondPaths = EnumeratePaths(
                root,
                maxEntries,
                maxPathCharacters,
                deadlineTimestamp,
                out secondChars);
            string firstSet = String.Join("\n", firstPaths.Select(row =>
                row.Item2 + ":" + Hash(
                    (String.Equals(root, row.Item1, StringComparison.OrdinalIgnoreCase)
                        ? "."
                        : row.Item1.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar))
                    .Replace(Path.DirectorySeparatorChar, '/')
                    .ToLowerInvariant())));
            string secondSet = String.Join("\n", secondPaths.Select(row =>
                row.Item2 + ":" + Hash(
                    (String.Equals(root, row.Item1, StringComparison.OrdinalIgnoreCase)
                        ? "."
                        : row.Item1.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar))
                    .Replace(Path.DirectorySeparatorChar, '/')
                    .ToLowerInvariant())));
            if (!String.Equals(firstSet, secondSet, StringComparison.Ordinal)
                || firstChars != secondChars)
                throw new ProbeException("TREE_CHANGED_DURING_PROBE", root, 0);

            foreach (Entry expected in first.Where(item => item.Kind == "directory")
                .OrderByDescending(item => item.RelativePath.Count(character => character == '/')))
            {
                uint desired = FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES;
                uint flags = FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS;
                SafeFileHandle handle = CreateFileW(
                    expected.FullPath,
                    desired,
                    0,
                    IntPtr.Zero,
                    OPEN_EXISTING,
                    flags,
                    IntPtr.Zero);
                if (handle == null || handle.IsInvalid)
                {
                    int code = Marshal.GetLastWin32Error();
                    if (handle != null) handle.Dispose();
                    throw new ProbeException("EXCLUSIVE_OPEN_FAILED", expected.FullPath, code);
                }
                BY_HANDLE_FILE_INFORMATION info;
                if (!GetFileInformationByHandle(handle, out info))
                {
                    int code = Marshal.GetLastWin32Error();
                    handle.Dispose();
                    throw new ProbeException("IDENTITY_QUERY_FAILED", expected.FullPath, code);
                }
                long size = ((long)info.FileSizeHigh << 32) | info.FileSizeLow;
                string identity = info.VolumeSerialNumber.ToString("X8")
                    + ":" + info.FileIndexHigh.ToString("X8")
                    + info.FileIndexLow.ToString("X8")
                    + ":" + info.NumberOfLinks.ToString()
                    + ":" + size.ToString()
                    + ":" + info.FileAttributes.ToString("X8");
                if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                {
                    handle.Dispose();
                    throw new ProbeException("REPARSE_POINT", expected.FullPath, 0);
                }
                if (!String.Equals(identity, expected.Identity, StringComparison.Ordinal)
                    || !String.Equals(FinalPath(handle), CanonicalPath(expected.FullPath), StringComparison.OrdinalIgnoreCase))
                {
                    handle.Dispose();
                    throw new ProbeException("IDENTITY_CHANGED", expected.FullPath, 0);
                }
                held.Add(new Held { Handle = handle, PathHash = expected.PathHash });
            }

            List<Entry> critical = first.Where(item => CriticalName(item.FullPath)).ToList();
            if (critical.Count > maxCriticalEntries)
                throw new ProbeException("CRITICAL_ENTRY_LIMIT_EXCEEDED", root, 0);
            result.criticalEntries = critical.Select(item => new CriticalEntry {
                identitySha256 = Hash(item.Identity),
                kind = item.Kind,
                linkCount = item.LinkCount,
                pathSha256 = item.PathHash,
                sizeBytes = item.SizeBytes
            }).ToList();
            result.criticalEntryCount = critical.Count;
            result.directoryCount = first.Count(item => item.Kind == "directory");
            result.entryCount = first.Count;
            result.fileCount = first.Count(item => item.Kind == "file");
            result.heldHandleCount = held.Count;
            result.identitySetSha256 = Hash(String.Join("\n", first.Select(item =>
                item.Kind + ":" + item.PathHash + ":" + Hash(item.Identity))));
            result.pathSetSha256 = Hash(result.rootPathSha256 + "\n" + firstSet);
            result.secondSnapshotEntryCount = secondPaths.Count;
            result.totalPathCharacters = firstChars;
            result.treeStable = true;
            result.allEntriesHeld = held.Count == first.Count;
            result.passed = result.allEntriesHeld;
        }
        catch (ProbeException error)
        {
            result.errorCode = error.Code;
            result.errorNativeCode = error.NativeCode;
            result.errorPathSha256 = error.PathHash;
        }
        catch (Exception error)
        {
            result.errorCode = "UNEXPECTED_PROBE_FAILURE_" + error.GetType().Name.ToUpperInvariant();
            result.errorNativeCode = 0;
            result.errorPathSha256 = result.rootPathSha256;
        }
        finally
        {
            for (int index = held.Count - 1; index >= 0; index -= 1)
            {
                Held item = held[index];
                try
                {
                    IntPtr raw = item.Handle.DangerousGetHandle();
                    bool closed = CloseHandle(raw);
                    int nativeCode = closed ? 0 : Marshal.GetLastWin32Error();
                    item.Handle.SetHandleAsInvalid();
                    item.Handle.Dispose();
                    if (!closed)
                    {
                        result.closeFailures.Add(new CloseFailure {
                            nativeCode = nativeCode,
                            pathSha256 = item.PathHash
                        });
                    }
                }
                catch (Exception)
                {
                    result.closeFailures.Add(new CloseFailure {
                        nativeCode = Marshal.GetLastWin32Error(),
                        pathSha256 = item.PathHash
                    });
                }
            }
            result.closeFailureCount = result.closeFailures.Count;
            if (result.closeFailureCount != 0) result.passed = false;
        }
        return result;
    }
}
`;

module.exports = { PACKAGE_UI_PROFILE_LOCK_PROBE_SOURCE };
