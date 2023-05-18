"use strict";
const Jvc = require("./jvc");
const { Mutex } = require("async-mutex");

let hap, Characteristic, Service;

module.exports = (api) => {
  hap = api.hap;
  Characteristic = hap.Characteristic;
  Service = hap.Service;
  api.registerAccessory("JvcDlaAccessory", JvcDlaAccessory);
};

class Information {
  #values = {
    Model: "DLA",
    SerialNumber: "".padStart(12, "0"),
    FirmwareRevision: "0.0",
  };
  constructor(accessory) {
    this.log = accessory.log;

    this.service = new Service.AccessoryInformation(accessory.name);
    this.service.setCharacteristic(Characteristic.Manufacturer, "JVC");

    Object.keys(this.#values).forEach((key) => {
      this.service.getCharacteristic(Characteristic[key]).onGet(async () => {
        const value = this.#values[key];
        this.log.info(`Get Information.${key}: ${value}`);
        return value;
      });

      this[`update${key}`] = (value) => this.#update(key, value);
    });
  }

  #update(key, value) {
    if (value && value !== this.#values[key]) {
      this.log.info(`Update Information.${key} to: ${value}`);
      this.#values[key] = value;
      this.service.getCharacteristic(Characteristic[key]).updateValue(value);
    }
  }
}

class PowerSwitch {
  #power = Jvc.Power.Off;

  constructor(accessory) {
    this.log = accessory.log;
    this.service = new Service.Switch(`${accessory.name} PowerSwitch`);
    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(async () => {
        const value = this.#power.isWarming || this.#power.isOn;
        this.log.info(`Get Power.On: ${value}`);
        return value;
      })
      .onSet(async (on) => {
        const logMessage = `Set Power.On to: ${on}`;
        if (on && !this.#power.isOff) {
          this.log.info(`${logMessage}, projector not off`);
          return;
        }
        if (!on && !this.#power.isOn) {
          this.log.info(`${logMessage}, projector not on`);
          return;
        }
        this.log.info(logMessage);
        await accessory.setPower(on);
      });
  }

  get power() {
    return this.#power;
  }

  updatePower(power) {
    if (power && power !== this.#power) {
      this.#power = power;
      const value = this.#power.isWarming || this.#power.isOn;
      this.log.info(`Update PowerSwitch.On to: ${value}`);
      this.service.getCharacteristic(Characteristic.On).updateValue(value);
    }
  }
}

class PositionState {
  static INCREASING = new PositionState("INCREASING");
  static DECREASING = new PositionState("DECREASING");
  static STOPPED = new PositionState("STOPPED");
  constructor(name) {
    this.name = name;
  }
  get value() {
    return Characteristic.PositionState[this.name];
  }
  toString() {
    return `${this.name} (${this.value})`;
  }
}

class LensPosition {
  #position = 10; // 10 - 100 in steps of 10
  #state = PositionState.STOPPED;

  constructor(accessory) {
    this.log = accessory.log;
    this.service = new Service.WindowCovering(`${accessory.name} LensPosition`);

    this.service
      .getCharacteristic(Characteristic.PositionState)
      .onGet(async () => {
        this.log.info(`Get Lens.PositionState: ${this.#state}`);
        return this.#state.value;
      });

    this.service
      .getCharacteristic(Characteristic.CurrentPosition)
      .onGet(async () => {
        this.log.info(`Get Lens.CurrentPosition: ${this.#position}`);
        return this.#position;
      });

    this.service
      .getCharacteristic(Characteristic.TargetPosition)
      .setProps({
        minValue: 10,
        maxValue: 100,
        minStep: 10,
      })
      .onGet(async () => {
        this.log.info(`Get Lens.TargetPosition: ${this.#position}`);
        return this.#position;
      })
      .onSet(async (position) => {
        position = 10 * Math.min(Math.max(Math.floor(position / 10), 1), 10);
        const logMessage = `Set Lens.TargetPosition to: ${position}`;
        if (!accessory.power.isOn) {
          this.log.info(`${logMessage}, projector not on`);
          this.service
            .getCharacteristic(Characteristic.TargetPosition)
            .updateValue(this.#position);
          return;
        }
        if (this.#state !== PositionState.STOPPED) {
          this.log.info(`${logMessage}, lens in motion`);
          return;
        }
        if (this.#position === position) {
          this.log.info(`${logMessage}, lens already in position`);
          return;
        }
        this.log.info(logMessage);
        this.#updateState(position);
        if (await accessory.setLensPosition(position)) {
          this.updatePosition(position);
        }
      });
  }

  #updateState(position) {
    let state;
    if (position > this.#position) {
      state = PositionState.INCREASING;
    } else if (position < this.#position) {
      state = PositionState.DECREASING;
    } else {
      state = PositionState.STOPPED;
    }
    if (state !== this.#state) {
      this.#state = state;
      this.log.info(`Update Lens.PositionState to: ${state}`);
      this.service
        .getCharacteristic(Characteristic.PositionState)
        .updateValue(state.value);
    }
  }

  updatePosition(position) {
    if (position >= 10 && position <= 100 && position !== this.#position) {
      this.#position = position;
      this.log.info(`Update Lens.CurrentPosition to: ${position}`);
      this.service
        .getCharacteristic(Characteristic.CurrentPosition)
        .updateValue(position);
      this.log.info(`Update Lens.TargetPosition to: ${position}`);
      this.service
        .getCharacteristic(Characteristic.TargetPosition)
        .updateValue(position);
      this.#updateState(position);
    }
  }
}

class JvcDlaAccessory {
  static #POLL_DELAY_OFF = 60 * 1000;
  static #POLL_DELAY_NOT_OFF = 5 * 1000;

  #jvc;
  #mutex;
  #information;
  #powerSwitch;
  #lensPosition;

  constructor(log, config) {
    this.log = log;
    this.name = config.name;

    this.#jvc = new Jvc(config.host);
    this.#mutex = new Mutex();
    this.#information = new Information(this);
    this.#powerSwitch = new PowerSwitch(this);
    this.#lensPosition = new LensPosition(this);
    this.#poll(JvcDlaAccessory.#POLL_DELAY_NOT_OFF);
  }

  getServices() {
    return [this.#information, this.#powerSwitch, this.#lensPosition].map(
      (obj) => obj.service
    );
  }

  get power() {
    return this.#powerSwitch.power;
  }

  async setPower(on) {
    await this.#send(on ? Jvc.Operation.Power.On : Jvc.Operation.Power.Off);
  }

  async setLensPosition(position) {
    return await this.#send(Jvc.Operation.LensMemory[position / 10]);
  }

  async #send(command) {
    const jvc = this.#jvc;
    await this.#mutex.acquire();
    try {
      this.log.info(`>>> ${command}`);
      await jvc.connect();
      // Lens operations take a while to ack so use a longer timeout
      jvc.setTimeout(60 * 1000);
      await jvc.send(command);
      this.log.info(`ACK ${command}`);
      return true;
    } catch (e) {
      this.log.info(`ERR ${command}`);
      this.log.info(e);
      return false;
    } finally {
      jvc.disconnect();
      await this.#mutex.release();
    }
  }

  #poll(delay) {
    const poll = async () => {
      const jvc = this.#jvc;
      await this.#mutex.acquire();
      try {
        await jvc.connect();

        this.#powerSwitch.updatePower(await jvc.getPower());
        this.#information.updateModel(await jvc.getModelCode());
        this.#information.updateSerialNumber(await jvc.getMacAddress());

        if (this.power.isOn) {
          this.#lensPosition.updatePosition((await jvc.getLensMemory()) * 10);
          this.#information.updateFirmwareRevision(
            await jvc.getSoftwareVersion()
          );
        }
      } catch (e) {
        this.log.info(e);
      } finally {
        jvc.disconnect();
        await this.#mutex.release();
      }
      const nextPollDelay = this.power.isOff
        ? JvcDlaAccessory.#POLL_DELAY_OFF
        : JvcDlaAccessory.#POLL_DELAY_NOT_OFF;
      if (nextPollDelay !== delay) {
        this.log.info(`Update #poll delay to: ${nextPollDelay / 1000}s`);
      }
      this.#poll(nextPollDelay);
    };
    const timeoutObj = setTimeout(poll, delay);
    timeoutObj.unref();
  }
}
