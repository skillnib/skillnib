export class ImportError extends Error {
  constructor(code, message) { super(message); this.name = 'ImportError'; this.code = code; }
}
export const LIMITS = { maxFileBytes: 1024 * 1024, maxMarkdownFiles: 2000, maxArchiveBytes: 256 * 1024 * 1024 };
