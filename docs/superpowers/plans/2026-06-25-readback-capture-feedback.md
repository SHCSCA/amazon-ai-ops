# Readback Capture Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the readback evidence capture drop zones visibly acknowledge drag-over, saving, and fixed-evidence states.

**Architecture:** Keep the readback capture interaction local to `readback-page.tsx` and style it with existing `readback-capture-*` CSS classes. Add a pure state builder so tests can verify the operator-facing copy and class contract without mounting browser drag APIs.

**Tech Stack:** React 18, TypeScript, Vitest, Electron renderer CSS.

---

### Task 1: Add Tested Capture State Copy

**Files:**
- Modify: `apps/desktop/src/renderer/pages/readback-page.tsx`
- Test: `apps/desktop/src/renderer/pages/readback-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
expect(readbackCaptureTargetView('before', { dragging: true })).toMatchObject({
  className: expect.stringContaining('readback-capture-dragging'),
  title: '松开即可存证',
  helper: '已识别拖入截图，松开鼠标后写入本地证据目录。',
});
```

- [ ] **Step 2: Implement the pure state builder**

```ts
export function readbackCaptureTargetView(
  slot: ReadbackCaptureSlot,
  input: { value?: string; saving?: boolean; dragging?: boolean },
) {
  const copy = CAPTURE_SLOT_LABELS[slot];
  const className = [
    'readback-capture-target',
    input.value ? 'readback-capture-filled' : '',
    input.saving ? 'readback-capture-saving' : '',
    input.dragging ? 'readback-capture-dragging' : '',
  ].filter(Boolean).join(' ');
  if (input.saving) return { className, title: '正在存证...', detail: copy.detail, helper: '正在写入本地证据目录...' };
  if (input.dragging) return { className, title: '松开即可存证', detail: copy.detail, helper: '已识别拖入截图，松开鼠标后写入本地证据目录。' };
  if (input.value) return { className, title: `${copy.title}已安全固定`, detail: copy.detail, helper: input.value };
  return { className, title: copy.title, detail: copy.detail, helper: '点击此区域后 Ctrl+V，或拖入图片文件' };
}
```

- [ ] **Step 3: Run focused test**

Run: `pnpm exec vitest run apps\desktop\src\renderer\pages\readback-page.test.tsx --reporter=basic`

Expected: PASS.

### Task 2: Add Drag-Over Visual Feedback

**Files:**
- Modify: `apps/desktop/src/renderer/pages/readback-page.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Test: `apps/desktop/src/renderer/pages/readback-page.test.tsx`

- [ ] **Step 1: Wire drag state in the capture target**

Use local `dragging` state, set it on `onDragEnter`/`onDragOver`, clear it on `onDragLeave`/`onDrop`, and render the pure state builder output.

- [ ] **Step 2: Add the marching border CSS**

```css
.readback-capture-dragging {
  border-color: var(--blue);
  background: #eff6ff;
  box-shadow: 0 0 0 3px rgb(37 99 235 / 0.16), inset 0 0 0 1px rgb(37 99 235 / 0.22);
  animation: readback-capture-marching-ants 520ms linear infinite, readback-capture-breathe 900ms ease-in-out infinite alternate;
}
```

- [ ] **Step 3: Run style contract test**

Add assertions that `styles.css` contains `.readback-capture-dragging`, `readback-capture-marching-ants`, and `readback-capture-breathe`.

Expected: PASS.
