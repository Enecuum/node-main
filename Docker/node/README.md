# Build Node Image

## Prerequisites 

1. Create a copy of `config.json.example` and name it `config.json`. (for sync with pulse network you need rename `config.pulse.example` to `config.json`)

2. Create a copy of `snapshot.json.example` and name it `snapshot.json`. 

3. If you want to create a full-node image, initialize the `explorer` submodule

4. Go to directory `\Docker\node`

5. Set permissions for run script `chmod +x build_image.sh`

## Build

Script Launch Options

1. Image name

2. Image type `POW`/`POS`/`FULLNODE`

### Example

`./build_image.sh enecuum/pulse_pos POS`
or
`./build_image.sh enecuum/pulse_pow POW`
or
`./build_image.sh enecuum/pulse_fullnode FULLNODE`