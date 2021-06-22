rm -rf scripts
mkdir scripts
echo 'Image name:'$1 

cp -r ../../sql/. scripts/

#build docker image
docker build -t $1 .