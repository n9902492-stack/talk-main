// Use installed Google Chrome on Windows, macOS or Linux. An explicit private
// CHROME_PATH can select another local executable without editing test files.
export const localChrome = () => process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH }
  : { channel: 'chrome' };
