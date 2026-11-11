// 终端交互输入。
//
// 只做一件 store 层不该管、但 CLI 必须有的事：**隐藏式读取密码**。
// 不用第三方库——把 stdin 切到 raw 模式、逐字符读、自己回显掩码即可。
import { createInterface } from 'node:readline';

// 读取一行可见输入（用于非敏感内容）
export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// 读取一行**不回显**的输入（密码）。
// stdin 不是 TTY（管道 / CI）时无法切 raw 模式，退回普通读取——
// 此时密码会显示在终端里，但至少流程不中断。
export async function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) return ask(question);

  return new Promise<string>((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let buf = '';
    const onData = (ch: string): void => {
      switch (ch) {
        case '\r':
        case '\n':
        case '\x04': // Ctrl-D
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buf.trim());
          break;
        case '\x03': // Ctrl-C
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          process.exit(130);
          break;
        case '\x7f': // Backspace
        case '\b':
          buf = buf.slice(0, -1);
          break;
        default:
          // 忽略其他控制字符，避免方向键之类混进密码
          if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}
