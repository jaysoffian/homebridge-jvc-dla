#!/usr/bin/env node
"use strict";
const Jvc = require("./jvc");
const { argv, exit } = require("node:process");

function usage() {
  console.log("usage: ping.js [-d|--debug] <host>");
  exit(1);
}

function parseArgs() {
  const args = {
    host: undefined,
    debug: false,
  };
  for (const arg of argv.slice(2)) {
    if (["--debug", "-d"].includes(arg)) {
      args.debug = true;
    } else if (arg.startsWith("-")) {
      console.log(`bad option: '${arg}'`);
      usage();
    } else if (!args.host) {
      args.host = arg;
    } else {
      console.log(`host already specified: '${args.host}'`);
      usage();
    }
  }
  if (!args.host) {
    console.log("must specify host");
    usage();
  }
  return args;
}

async function ping() {
  const args = parseArgs();
  const jvc = new Jvc(args.host, args.debug ? console.log : () => undefined);
  const power = await jvc.getPower();
  console.log(`Power ${power}`);
  console.log(`Model ${await jvc.getModelCode()}`);
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
