"use strict";
const Jvc = require("./jvc");
const { Mutex } = require("async-mutex");

let hap;

module.exports = (api) => {
  hap = api.hap;
  api.registerAccessory("JvcDlaAccessory", JvcDlaAccessory);
};

class Information {
  constructor(accessory) {
    this.log = accessory.log;

    this.service = new hap.Service.AccessoryInformation();
    this.service.setCharacteristic(hap.Characteristic.Manufacturer, "JVC");

    this._firmwareRevision = undefined;
    this.service
      .getCharacteristic(hap.Characteristic.FirmwareRevision)
      .onGet(async () => this._firmwareRevision ?? "???");

    this._model = undefined;
    this.service
      .getCharacteristic(hap.Characteristic.Model)
      .onGet(async () => this._model ?? "???");

    this._serialNumber = undefined;
    this.service
      .getCharacteristic(hap.Characteristic.SerialNumber)
      .onGet(async () => this._serialNumber ?? "???");
  }

  set model(model) {
    if (model && model !== this._model) {
      this.log.info(`Model: ${model}`);
      this._model = model;
      this.service
        .getCharacteristic(hap.Characteristic.Model)
        .updateValue(this._model);
    }
  }

  set serialNumber(serialNumber) {
    if (serialNumber && serialNumber !== this._serialNumber) {
      this.log.info(`SerialNumber: ${serialNumber}`);
      this._serialNumber = serialNumber;
      this.service
        .getCharacteristic(hap.Characteristic.SerialNumber)
        .updateValue(this._serialNumber);
    }
  }

  set firmwareRevision(firmwareRevision) {
    if (firmwareRevision && firmwareRevision !== this._firmwareRevision) {
      this.log.info(`FirmwareRevision: ${firmwareRevision}`);
      this._firmwareRevision = firmwareRevision;
      this.service
        .getCharacteristic(hap.Characteristic.FirmwareRevision)
        .updateValue(this._firmwareRevision);
    }
  }
}

class PowerSwitch {
  constructor(accessory) {
    this.log = accessory.log;
    this._state = undefined;
    this.service = new hap.Service.Switch(`${accessory.name} Power`);
    this.service
      .getCharacteristic(hap.Characteristic.On)
      .onGet(async () => this.isWarmingOrOn)
      .onSet(accessory.setPower.bind(accessory));
  }

  get isWarmingOrOn() {
    return [Jvc.Power.Warming, Jvc.Power.On].includes(this._state);
  }

  get state() {
    return this._state;
  }

  set state(state) {
    if (state !== this._state) {
      this.log.info(`Power: ${state}`);
      this._state = state;
      this.service
        .getCharacteristic(hap.Characteristic.On)
        .updateValue(this.isWarmingOrOn);
    }
  }
}

class LensPosition {
  constructor(accessory) {
    this.log = accessory.log;
    this.service = new hap.Service.WindowCovering(`${this.name} Lens`);

    this._state = hap.Characteristic.PositionState.STOPPED;
    this.service
      .getCharacteristic(hap.Characteristic.PositionState)
      .onGet(async () => this._state);

    this._current = 10;
    this.service
      .getCharacteristic(hap.Characteristic.CurrentPosition)
      .onGet(async () => this._current);

    this._target = 10;
    this.service
      .getCharacteristic(hap.Characteristic.TargetPosition)
      .onGet(async () => this._target)
      .onSet(accessory.setLensPosition.bind(accessory))
      .setProps({
        minValue: 10,
        maxValue: 100,
        minStep: 10,
      });
  }

  get isStopped() {
    return this._state === hap.Characteristic.PositionState.STOPPED;
  }

  set state(state) {
    if (state !== this._state) {
      this.log.info(`Lens state: ${state}`);
      this._state = state;
      this.service
        .getCharacteristic(hap.Characteristic.PositionState)
        .updateValue(this._state);
    }
  }

  set current(current) {
    if (current && current !== this._current) {
      this.log.info(`Lens current: ${current}`);
      this._current = current;
      this.service
        .getCharacteristic(hap.Characteristic.CurrentPosition)
        .updateValue(this._current);
    }
    if (this._current === this._target) {
      this.state = hap.Characteristic.PositionState.STOPPED;
    }
  }

  equals = (position) => position === this._current;

  get command() {
    return Jvc.Operation.LensMemory[this._target / 10];
  }

  set target(target) {
    target = Math.max(Math.floor(target / 10), 1) * 10;
    if (target !== this._target) {
      this.log.info(`Lens target: ${target}`);
      this._target = target;
      this.service
        .getCharacteristic(hap.Characteristic.TargetPosition)
        .updateValue(this._target);
    }
    if (target > this._current) {
      this.state = hap.Characteristic.PositionState.INCREASING;
    } else if (target < this._current) {
      this.state = hap.Characteristic.PositionState.DECREASING;
    } else {
      this.state = hap.Characteristic.PositionState.STOPPED;
    }
  }
}

class JvcDlaAccessory {
  constructor(log, config) {
    this.log = log;

    this.name = config.name;
    this.jvc = new Jvc(config.host);
    this.mutex = new Mutex();
    this.information = new Information(this);
    this.powerSwitch = new PowerSwitch(this);
    this.lensPosition = new LensPosition(this);
    this.poll(1);
  }

  getServices() {
    return [this.information, this.powerSwitch, this.lensPosition].map(
      (obj) => obj.service
    );
  }

  async setPower(turnOn) {
    this.log.info(`Set power: ${turnOn ? "on" : "off"}`);

    if (turnOn) {
      if (this.powerSwitch.state !== Jvc.Power.Off) {
        this.log.info("Can't power-on (projector not off)");
        return;
      }
      await this.command(Jvc.Operation.Power.On);
    } else {
      if (this.powerSwitch.state !== Jvc.Power.On) {
        this.log.info("Can't power-off (projector not on)");
        return;
      }
      await this.command(Jvc.Operation.Power.Off);
    }
  }

  async setLensPosition(position) {
    this.log.info(`Set lens position: ${position}`);

    if (this.powerSwitch.state !== Jvc.Power.On) {
      this.log.info("Can't set lens (projector not on)");
      return;
    }

    if (!this.lensPosition.isStopped) {
      this.log.info("Can't set lens (lens not stopped)");
      return;
    }

    if (this.lensPosition.equals(position)) {
      this.log.info("Can't set lens (lens already in position)");
      return;
    }

    this.lensPosition.target = position;
    await this.command(this.lensPosition.command);
  }

  async command(command) {
    await this.mutex.acquire();
    try {
      this.log.debug(`Sending command ${command}`);
      await this.jvc.connect();
      // Use a longer timeout when sending operations since the projector doesn't
      // return a response till the operation is completed. Moving the lens position
      // can take a while to complete.
      this.jvc.setTimeout(60 * 1000);
      await this.jvc.send(command);
    } catch (e) {
      this.log.info(`[ERROR] ${e}`);
    } finally {
      this.jvc.disconnect();
      await this.mutex.release();
    }
  }

  poll(delay) {
    const func = async () => {
      const { jvc } = this;
      await this.mutex.acquire();
      try {
        this.log.debug("Polling projector status");
        await this.jvc.connect();
        this.powerSwitch.state = await jvc.getPower();
        this.information.model = await jvc.getModel();
        this.information.serialNumber = await jvc.getMacAddress();
        if (this.powerSwitch.state === Jvc.Power.On) {
          this.information.firmwareRevision = await jvc.getSoftwareVersion();
          this.lensPosition.current = (await jvc.getLensMemory()) * 10;
        }
      } catch (e) {
        this.log.info(`[ERROR] ${e}`);
      } finally {
        jvc.disconnect();
        await this.mutex.release();
      }
      this.poll(1000 * (this.powerSwitch.isOff ? 60 : 5));
    };
    const timeoutObj = setTimeout(func, delay);
    timeoutObj.unref();
  }
}
