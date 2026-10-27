module.exports = function createInspectorModule(dependencies) {
  const {
    USAGE,
  } = dependencies;
  const inspect = (...args) => dependencies.inspect(...args);
  const parseArgs = (...args) => dependencies.parseArgs(...args);

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const result = inspect(parsed);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === 'RESUME_SAFE' ? 0 : 1;
}

  return {
    main,
  };
};
