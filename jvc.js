"use strict";
const { PromiseSocket, TimeoutError } = require("promise-socket");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = (s) => Buffer.from(s, "latin1");
const latin1 = (buf) => buf.toString("latin1");
const hex = (buf) => buf.toString("hex");

class Power {
  static Off = new Power("Off");
  static On = new Power("On");
  static Cooling = new Power("Cooling");
  static Warming = new Power("Warming");
  static Emergency = new Power("Emergency");
  constructor(name) {
    this.name = name;
  }
  toString() {
    return this.name;
  }
  get isOn() {
    return this === Power.On;
  }
  get isOff() {
    return this === Power.Off;
  }
}

class JvcError extends Error {
  constructor(error) {
    super(error);
    this.name = "JvcError";
  }
}

class Command {
  constructor(type, code, length, decode) {
    this.type = type;
    this.code = code;
    this.length = length;
    this.decode = decode;
  }

  toString() {
    return `${this.type}${hex(bytes(this.code))}`;
  }

  static #Operation = (...args) => new Command("!", ...args);
  static Operation = {
    Null: Command.#Operation("\x00\x00"),
    Power: {
      Off: Command.#Operation("PW0"),
      On: Command.#Operation("PW1"),
    },
    LensMemory: {
      1: Command.#Operation("INML0"),
      2: Command.#Operation("INML1"),
      3: Command.#Operation("INML2"),
      4: Command.#Operation("INML3"),
      5: Command.#Operation("INML4"),
      6: Command.#Operation("INML5"),
      7: Command.#Operation("INML6"),
      8: Command.#Operation("INML7"),
      9: Command.#Operation("INML8"),
      10: Command.#Operation("INML9"),
    },
  };

  static #Reference = (...args) => new Command("?", ...args);
  static Reference = {
    Power: Command.#Reference("PW", 1, (c) => {
      return {
        0: Power.Off, // Standby
        1: Power.On, // Lamp On
        2: Power.Cooling, // Cooling
        3: Power.Warming, // Reserved
        4: Power.Emergency, // Emergency
      }[c];
    }),
    LensMemory: Command.#Reference("INML", 1, (c) => parseInt(c) + 1),
    Model: Command.#Reference("MD", 14, (s) => s),
    SoftwareVersion: Command.#Reference("IFSV", 6, (s) => s),
    MacAddress: Command.#Reference("LSMA", 12, (s) => s),
  };
}

class Jvc {
  static Reference = Command.Reference;
  static Operation = Command.Operation;
  static Error = JvcError;
  static TimeoutError = TimeoutError;
  static Power = Power;

  constructor(host, debug) {
    this.host = host;
    this.sock = null;
    this.debug = debug || (() => undefined);
  }

  async _connect() {
    this.disconnect();

    const [PJ_OK, PJREQ, PJACK] = ["PJ_OK", "PJREQ", "PJACK"].map(bytes);
    const sock = (this.sock = new PromiseSocket());

    sock.setTimeout(2 * 1000);

    await sock.connect({
      host: this.host,
      port: 20554,
    });

    // Check for PJ_OK
    let resp = await sock.read(PJ_OK.length);
    if (!PJ_OK.equals(resp)) {
      throw new JvcError("Did not receive PJ_OK");
    }

    // Send PJREQ
    await sock.write(PJREQ);

    // Check for PJACK
    resp = await sock.read(PJACK.length);
    if (!PJACK.equals(resp)) {
      throw new JvcError("Did not receive PJACK");
    }

    // Issue null command to ensure we're connected
    await this._send(Jvc.Operation.Null);
  }

  async connect() {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await this._connect();
        return;
      } catch (e) {
        if (attempt > 3) {
          console.error(e);
        }
        await sleep(attempt * 1100);
      }
    }
    throw new JvcError("Did not connect");
  }

  disconnect() {
    if (this.sock !== null) {
      this.sock.destroy();
      this.sock = null;
    }
  }

  setTimeout(ms) {
    if (this.sock !== null) {
      this.sock.setTimeout(ms);
    }
  }

  async _send(command) {
    this.debug(command);

    const { type, code } = command;
    const unit_id = "\x89\x01";
    const request = bytes(`${type}${unit_id}${code}\n`);
    const ack = bytes(`\x06${unit_id}${code.substr(0, 2)}\n`);

    this.debug(command.type + " " + hex(request));
    await this.sock.write(request);

    let resp = await this.sock.read(ack.length);
    this.debug("A " + hex(resp));

    if (!ack.equals(resp)) {
      throw new JvcError("Did not receive ACK");
    }

    if (command.type !== "?") {
      return;
    }

    const prefix = bytes(`@${unit_id}${code.substr(0, 2)}`);

    resp = await this.sock.read(prefix.length + command.length + 1);
    this.debug("@ " + hex(resp));

    if (!prefix.equals(resp.slice(0, prefix.length))) {
      throw new JvcError("Did not receive response prefix");
    }

    if (resp.readUInt8(resp.length - 1) !== 0x0a) {
      throw new JvcError("Did not receive response end");
    }

    return command.decode(latin1(resp.slice(prefix.length, -1)));
  }

  async send(command) {
    try {
      if (this.sock === null) {
        await this.connect();
      }
      return await this._send(command);
    } catch (e) {
      console.error(e);
      this.disconnect();
      return null;
    }
  }

  async getPower() {
    return await this.send(Jvc.Reference.Power);
  }

  async getModel() {
    const value = await this.send(Jvc.Reference.Model);
    return /^ILAFPJ -- (.*)$/.exec(value)[1];
  }

  async getMacAddress() {
    return await this.send(Jvc.Reference.MacAddress);
  }

  async getSoftwareVersion() {
    return await this.send(Jvc.Reference.SoftwareVersion);
  }

  async getLensMemory() {
    return await this.send(Jvc.Reference.LensMemory);
  }
}

module.exports = Jvc;
