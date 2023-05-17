# homebridge-jvc-dla

A Homebridge plugin to control JVC DLA projectors

## Features

- Turn projector on/off.
- Set projector lens memory position. 

  This is exposed to HomeKit as a Window Covering with range 10-100% in 10%
  steps, so:

    - 10% is lens memory 1.
	- 20% is lens memory 2.
	- ... 
	- 100% is lens memory 10.
  
  I suggest making a scene for each position so it's a single tap to switch the
  active lens memory.

- Reports the projector's model string, mac address (as serial
  number), and software version (as firmware version).
- Entirely in JavaScript. Does not require Python.

## Installation

1. Install using the Homebridge Config UI X or via the command line:

       npm install -g homebridge-jvc-dla

2. Configure the plugin

## Configuration

- `name`: Name of the accessory instance.
- `host`: Projector host name or IP address.

