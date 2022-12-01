rm -rf build
mkdir -p build/ext
echo 'Image name:'$1
echo 'Image type:'$2
##!/usr/bin/env bash
CONFIG_FILE='config.json';
BASE_CONFIG=../../$CONFIG_FILE;
GIT_HASH=$(git rev-parse HEAD)
##edit config.json add git hash
node > build/${CONFIG_FILE} <<EOF
const fs = require('fs');
//Read data
let filename = '${BASE_CONFIG}';
let cfg = {};
try {
	cfg = JSON.parse(fs.readFileSync(filename, 'utf8'));
} catch (e) {
	console.log('No configuration file found.', e );
}
//Manipulate data
cfg.git_hash = '${GIT_HASH}';
cfg.ip_api_key = '';
cfg.ecc.short.msk = undefined;
cfg.ecc.long.msk = undefined;
cfg.loglevel = 'info';
//Output data
console.log(JSON.stringify(cfg));
EOF
SNAPSHOT_FILE=$(grep snapshot_file $BASE_CONFIG | sed 's/.*: "\(.*\)",/\1/')
echo $SNAPSHOT_FILE
#obfuscation js files
cp ../../*.js build
#copy snapshot file and explorer folder
cp ../../package.json build/package.json
cp ../../$SNAPSHOT_FILE build/$SNAPSHOT_FILE
cp -rf ../../explorer/ build/explorer/
#build docker image
docker build -t $1 --build-arg  BUILDVAR=$2 .
