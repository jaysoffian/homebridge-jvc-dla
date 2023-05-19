#!/usr/bin/env node
"use strict";
const Jvc = require("./jvc");
const { exit } = require("node:process");
const { parseArgs: _parseArgs } = require("node:util");

function usage() {
  console.log("usage: ping.js [options...] <host>");
  console.log(" -p, --password   Specify password (default: no password)");
  console.log(" -P, --port       Specify port (default: 20554)");
  console.log(" -d, --debug      Enable debug output");
  console.log(" --help           Show this message and quit");
  exit(1);
}

function parseArgs() {
  const options = {
    port: {
      type: "string",
      short: "P",
    },
    password: {
      type: "string",
      short: "p",
    },
    debug: {
      type: "boolean",
      short: "d",
    },
    help: {
      type: "boolean",
    },
  };
  let args;
  try {
    args = _parseArgs({ options, allowPositionals: true, strict: true });
  } catch (e) {
    console.log(`ping.js: ${e.message}`);
    usage();
  }
  if (args.values.help || args.positionals.length !== 1) {
    usage();
  }
  return {
    host: args.positionals[0],
    port: args.values.port,
    password: args.values.password,
    debug: args.values.debug ? console.log : undefined,
  };
}

async function ping() {
  const jvc = new Jvc(parseArgs());
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
