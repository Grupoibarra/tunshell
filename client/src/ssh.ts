import * as stream from 'stream';
import * as crypto from 'crypto';
import * as net from 'net';
import * as ssh2 from 'ssh2';
import * as pty from 'node-pty';

export interface SshConfig {
  socket: stream.Duplex;
  username: string;
  password: string;
}

export class Ssh {
  constructor(private readonly config: SshConfig) {}

  public setupSshServer = async () => {
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
    const privateKey = keyPair.privateKey.export({ format: 'pem', type: 'pkcs1' });

    return new Promise((resolve) => {
      const server = new ssh2.Server(
        {
          hostKeys: [privateKey],
          debug: console.log,
        },
        (client) => {
          client
            .on('authentication', (ctx) => {
              const user = Buffer.from(ctx.username);
              if (
                user.length !== this.config.username.length ||
                !crypto.timingSafeEqual(user, Buffer.from(this.config.username))
              ) {
                return ctx.reject();
              }

              ctx.accept();
            })
            .on('ready', () => {
              console.log('Client authenticated!');

              client.on('session', function (accept, reject) {
                const session = accept();
                let userPty;
                session.once('pty', function (accept, reject, info) {
                  userPty = info;
                  accept();
                });
                session.once('shell', function (accept, reject) {
                  console.log('shell');

                  if (!userPty) {
                    reject();
                  }

                  var channel = accept();

                  var shell = pty.spawn('bash', [], {
                    name: 'xterm-color',
                    cols: userPty.cols,
                    rows: userPty.rows,
                    env: process.env,
                  });

                  shell.onData((data) => {
                    console.log('data', data);
                    channel.stdout.write(data);
                  });

                  channel.stdin.on('data', (data) => {
                    shell.write(data);
                  });

                  shell.on('exit', () => {
                    channel.end();
                  });
                });
              });
            })
            .on('end', function () {
              console.log('Client disconnected');
              resolve();
            });
        },
      );

      const listener = ((server as any)._srv as net.Server).listeners('connection')[0];
      listener(this.config.socket);
    });
  };

  public connectToHostSshSession = async () => {
    const client = new ssh2.Client();

    return new Promise((resolve) => {
      client
        .on('ready', () => {
          console.log('Client :: ready');
          client.shell((err, stream) => {
            if (err) throw err;
            stream
              .on('close', () => {
                console.log('Stream :: close');
                client.end();
                resolve();
              })
              .on('data', (data) => {
                process.stdout.write(data);
              });

            console.clear();
            process.stdin.on('data', (data) => {
              stream.write(data);
            });
          });
        })
        .connect({
          sock: this.config.socket,
          username: this.config.username,
          password: this.config.password,
          debug: console.log
        });
    });
  };
}
