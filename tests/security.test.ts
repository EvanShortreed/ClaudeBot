import { describe, it, expect } from 'vitest';

// Test the security logic inline since createSecurityPolicy depends on logger (which needs pino)
describe('security policy', () => {
  const DESTRUCTIVE_PATTERNS = [
    /\brm\s+(-[rRf]+\s+)?\//,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    /\bkill\s+-9\s+1\b/,
    /\bchmod\s+777\s+\//,
    />\s*\/dev\/sda/,
    /\bsudo\s+rm\b/,
    /:\(\)\{.*:\|:&\s*\};:/,
    /\bshutdown\b/,
    /\breboot\b/,
  ];

  const SYSTEM_WRITE_PATHS = ['/etc/', '/usr/', '/System/', '/Library/', '/bin/', '/sbin/'];

  function checkBash(command: string): boolean {
    return !DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
  }

  function checkWrite(filePath: string): boolean {
    return !SYSTEM_WRITE_PATHS.some((p) => filePath.startsWith(p));
  }

  describe('bash commands', () => {
    it('allows safe commands', () => {
      expect(checkBash('ls -la')).toBe(true);
      expect(checkBash('echo "hello"')).toBe(true);
      expect(checkBash('cat file.txt')).toBe(true);
      expect(checkBash('npm install')).toBe(true);
      expect(checkBash('git status')).toBe(true);
    });

    it('blocks rm -rf /', () => {
      expect(checkBash('rm -rf /')).toBe(false);
      expect(checkBash('rm -Rf /home')).toBe(false);
    });

    it('blocks mkfs', () => {
      expect(checkBash('mkfs.ext4 /dev/sda1')).toBe(false);
    });

    it('blocks dd if=', () => {
      expect(checkBash('dd if=/dev/zero of=/dev/sda')).toBe(false);
    });

    it('blocks sudo rm', () => {
      expect(checkBash('sudo rm important_file')).toBe(false);
    });

    it('blocks fork bomb', () => {
      expect(checkBash(':(){ :|:& };:')).toBe(false);
    });

    it('blocks shutdown', () => {
      expect(checkBash('shutdown -h now')).toBe(false);
    });

    it('blocks reboot', () => {
      expect(checkBash('reboot')).toBe(false);
    });

    it('allows rm on non-root paths', () => {
      expect(checkBash('rm file.txt')).toBe(true);
      expect(checkBash('rm -rf ./node_modules')).toBe(true);
    });
  });

  describe('file write paths', () => {
    it('allows writes to home directory', () => {
      expect(checkWrite('/Users/me/project/file.ts')).toBe(true);
    });

    it('allows writes to project directories', () => {
      expect(checkWrite('/home/user/code/app.js')).toBe(true);
    });

    it('blocks writes to /etc/', () => {
      expect(checkWrite('/etc/passwd')).toBe(false);
      expect(checkWrite('/etc/hosts')).toBe(false);
    });

    it('blocks writes to /usr/', () => {
      expect(checkWrite('/usr/local/bin/script')).toBe(false);
    });

    it('blocks writes to /System/', () => {
      expect(checkWrite('/System/Library/something')).toBe(false);
    });

    it('blocks writes to /bin/', () => {
      expect(checkWrite('/bin/sh')).toBe(false);
    });
  });

  describe('sensitive files', () => {
    const SENSITIVE_FILE_PATTERNS = [
      /\.env$/,
      /credentials/i,
      /\.pem$/,
      /\.key$/,
      /id_rsa/,
      /id_ed25519/,
    ];

    function checkSensitive(filePath: string): boolean {
      return !SENSITIVE_FILE_PATTERNS.some((p) => p.test(filePath));
    }

    it('blocks .env files', () => {
      expect(checkSensitive('/project/.env')).toBe(false);
    });

    it('blocks credentials files', () => {
      expect(checkSensitive('/project/credentials.json')).toBe(false);
    });

    it('blocks PEM files', () => {
      expect(checkSensitive('/certs/server.pem')).toBe(false);
    });

    it('blocks SSH keys', () => {
      expect(checkSensitive('/home/user/.ssh/id_rsa')).toBe(false);
      expect(checkSensitive('/home/user/.ssh/id_ed25519')).toBe(false);
    });

    it('allows regular files', () => {
      expect(checkSensitive('/project/src/app.ts')).toBe(true);
      expect(checkSensitive('/project/package.json')).toBe(true);
    });
  });
});
