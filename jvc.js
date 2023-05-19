// jvc.js
// ~~~~~~
// JVC D-ILA Projector LAN Remote Control Protocol Client.
//
// References:
//
// JVC D-ILA Projector RS-232C, LAN and Infrared Remote Control Guide (2011)
// - XH4: DLA-HD350
// - XH7: DLA-RS10
// - XH5: DLA-HD750, DLA-RS20
// - XH8: DLA-HD550
// - XHA: DLA-RS15
// - XH9: DLA-HD950, DLA-HD990, DLA-RS25, DLA-RS35
// - XHB: DLA-X3, DLA-RS40
// - XHC: DLA-X7, DLA-X9, DLA-RS50, DLA-RS60
// - XHE: DLA-X30, DLA-RS45
// - XHF: DLA-X70R, DLA-X90R, DLA-RS55, DLA-RS65
// https://support.jvc.com/consumer/support/documents/DILAremoteControlGuide.pdf
//
// D-ILA® Projector Cedia Command Communication Specification (2013)
// - DLA-RS46
// - DLA-RS4810
// - DLA-RS48
// - DLA-RS56
// - DLA-RS66
// http://pro.jvc.com/pro/attributes/PRESENT/manual/2013_model_JVC_Prof_Version_v1.2%20English.pdf
//
// D-ILA® Projector RS232 Command Communication Specification (2014)
// - DLA-RS49
// - DLA-RS4910
// - DLARS57
// - DLA-RS67/RS6710
// http://pro.jvc.com/pro/attributes/PRESENT/manual/RS_Model_2014_RS232_Command_Spec.pdf
//
// D-ILA® Projector JVC External Control Command Communication Specification (2015)
// - DLA-X550R/X5000/XC5890R/RS400 Series
// - DLA-XC6890 Series
// - DLA-X750R/X7000/XC7890R/RS500 Series
// - DLA-X950R/X9000/RS600/PX1 Series
// https://support.jvc.com/consumer/support/documents/2015model_JVC_External_Control_Command_spec_v1_0.pdf
//
// D-ILA® Projector External Communication Specification (2017)
// - DLA-X570R, RS420 Series
// - DLA-X770R, RS520
// - DLA-X970, RS620 Series
// http://pro.jvc.com/pro/attributes/PRESENT/manual/MK8_Ext_spec_v1_0%20English_Final.pdf
//
// D-ILA Projector External Command Communication Specification (2018)
// - B2A1: DLA-RS3000, NX9, NX11, V9R Series
// - B2A2: DLA-RS2000, NX7, N8, V7 Series
// - B2A3: DLA-RS1000, NX5, N5, N6, V5 Series
// https://www.us.jvc.com/projectors/pdf/2018_ILA-FPJ_Ext_Command_List_v1.2.pdf
//
// D-ILA Projector 2021 Model LAN connection specification
// - NP5 / RS1100
// - NZ7 / RS2100
// - NZ8 / RS3100
// - NZ9 / RS4100
// https://www.snapav.com/wcsstore/ExtendedSitesCatalogAssetStore/attachments/documents/ProjectionScreens/SupportDocuments/ILAFPJ2021_LANconnection_spec_EN.pdf

"use strict";
const assert = require("node:assert");
const { PromiseSocket, TimeoutError } = require("promise-socket");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = (s) => Buffer.from(s, "latin1");
const latin1 = (buf, ...args) => buf.slice(...args).toString("latin1");
const hex = (buf, ...args) =>
  buf
    .slice(...args)
    .toString("hex")
    .split(/(..)/)
    .filter((x) => !!x)
    .join(" ");

const [PJ_OK, PJREQ, PJACK] = ["PJ_OK", "PJREQ", "PJACK"].map(bytes);
const [OPERATION, REFERENCE, RESPONSE, ACK] = ["!", "?", "@", "\x06"];
const UNIT_ID = "\x89\x01";
const END = "\n";

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
  get isOff() {
    return this === Power.Off;
  }
  get isOn() {
    return this === Power.On;
  }
  get isCooling() {
    return this === Power.Cooling;
  }
  get isWarming() {
    return this === Power.Warming;
  }
  get isEmergency() {
    return this === Power.Emergency;
  }
}

class CommandError extends Error {
  constructor(...args) {
    super(...args);
    this.name = "CommandError";
  }
}

class Command {
  constructor(type, code, length, decode) {
    assert(
      (type === REFERENCE && length > 0 && typeof decode === "function") ||
        (type == OPERATION && length === undefined && decode == undefined)
    );
    this.type = type;
    this.code = code;
    this.length = length;
    this.decode = decode;
  }

  toString() {
    return JSON.stringify(latin1(bytes(this.code)));
  }

  get request() {
    return bytes(`${this.type}${UNIT_ID}${this.code}\n`);
  }

  get ack() {
    return bytes(`${ACK}${UNIT_ID}${this.code.substr(0, 2)}\n`);
  }

  get response_prefix() {
    return bytes(`${RESPONSE}${UNIT_ID}${this.code.substr(0, 2)}`);
  }

  get response_length() {
    return 5 /* response_prefix */ + this.length + 1 /* \n */;
  }

  static #Operation = (...args) => new Command(OPERATION, ...args);
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

  static #Reference = (...args) => new Command(REFERENCE, ...args);
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
  static Operation = Command.Operation;
  static Reference = Command.Reference;
  static CommandError = CommandError;
  static TimeoutError = TimeoutError;
  static Power = Power;

  constructor(host, debug) {
    assert(debug === undefined || typeof debug === "function");
    this.host = host;
    this.sock = null;
    this.debug = debug || (() => undefined);
  }

  async _connect() {
    this.disconnect();

    const sock = (this.sock = new PromiseSocket());

    sock.setTimeout(2 * 1000);

    await sock.connect({
      host: this.host,
      port: 20554,
    });

    // Check for PJ_OK
    let resp = await sock.read(PJ_OK.length);
    if (!PJ_OK.equals(resp)) {
      throw new CommandError("Did not receive PJ_OK");
    }
    this.debug("<<< PJ_OK");

    // Send PJREQ
    this.debug(">>> PJREQ");
    await sock.write(PJREQ);

    // Check for PJACK
    resp = await sock.read(PJACK.length);
    if (!PJACK.equals(resp)) {
      throw new CommandError("Did not receive PJACK");
    }
    this.debug("<<< PJACK");

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
    throw new CommandError("Did not connect");
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
    this.debug(`CMD ${command}`);

    const { type, request, ack } = command;

    this.debug(`>>> ${hex(request)}`);
    await this.sock.write(request);

    let resp = await this.sock.read(ack.length);
    this.debug(`ACK ${hex(resp)}`);

    if (!ack.equals(resp)) {
      throw new CommandError("Did not receive ACK");
    }

    if (type === OPERATION) {
      return;
    }

    const { response_length, response_prefix } = command;

    resp = await this.sock.read(response_length);
    this.debug(`<<< ${hex(resp)}`);

    if (!response_prefix.equals(resp.slice(0, response_prefix.length))) {
      throw new CommandError("Did not receive response prefix");
    }

    if (latin1(resp, -1) !== END) {
      throw new CommandError("Did not receive response end");
    }

    return command.decode(latin1(resp, response_prefix.length, -1));
  }

  async send(command) {
    try {
      if (this.sock === null) {
        await this.connect();
      }
      return await this._send(command);
    } catch (e) {
      this.disconnect();
      throw new CommandError(e.message, { cause: e });
    }
  }

  async getPower() {
    return await this.send(Jvc.Reference.Power);
  }

  async setPower(on) {
    await this.send(on ? Jvc.Operation.Power.On : Jvc.Operation.Power.Off);
  }

  async getModelCode() {
    const value = await this.send(Jvc.Reference.Model);
    const match = /^ILAFPJ -- (.{4})$/.exec(value);
    if (match) {
      return match[1].replace(/^-/, "");
    }
  }

  async getMacAddress() {
    return await this.send(Jvc.Reference.MacAddress);
  }

  async getSoftwareVersion() {
    const value = await this.send(Jvc.Reference.SoftwareVersion);
    const match = /^(\d{2})(\d{2})PJ/.exec(value); // e.g. "0352PJ"
    return match ? `${match[1]}.${match[2]}` : value;
  }

  async getLensMemory() {
    return await this.send(Jvc.Reference.LensMemory);
  }

  async setLensMemory(memory) {
    const command = Jvc.Operation.LensMemory[memory];
    if (command === undefined) {
      throw new CommandError(`Invalid memory: ${memory}`);
    }
    await this.send(command);
  }
}

module.exports = Jvc;
