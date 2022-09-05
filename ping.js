#!/usr/bin/env node
"use strict";
const Jvc = require("./jvc");
const { argv } = require("node:process");

async function ping() {
  const jvc = new Jvc(argv[2]);
  const power = await jvc.getPower();
  console.log(`Power ${power}`);
  console.log(`Model ${await jvc.getModel()}`);
  console.log(`Mac ${await jvc.getMacAddress()}`);
  if (power.isOn) {
    console.log(`Lens ${await jvc.getLensMemory()}`);
    console.log(`Ver ${await jvc.getSoftwareVersion()}`);
  }
  jvc.disconnect();
}

ping()
  .then()
  .catch((error) => console.error(error));
