# Base image
FROM node:slim
 
# Creating a directory inside the base image and defining as the base directory
WORKDIR /app
 
# Copying the files of the root directory into the base directory
ADD /build /app

ARG BUILDVAR

RUN if [ "$BUILDVAR" = "POW" ] || [ "$BUILDVAR" = "POS" ] ; then \
	rm Explorer.js  ;\
	rm Stat.js ;\
	rm -r explorer ;\
	rm iexplorer.js ;\
	rm istat.js ;\
	rm stakecalc.js ;\
elif [ "$BUILDVAR" = "FULLNODE" ] ; then \
	rm iminer.js ;\
	rm Miner.js ;\
	rm ilpos.js ;\
    rm LPOS.js ;\
fi

#files in container
RUN ls

#ADD . /app;\
 
# install git
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y git

# install 
RUN apt-get install -y libgmp-dev libgivaro9
# Installing the project dependencies
RUN npm install
RUN npm install pm2@3.5.0 -g

# Exposing the RestAPI port
EXPOSE 8000
EXPOSE 3306
EXPOSE 80

ENV DB_HOST 'dbhost'
ENV DB_PORT '3306'
ENV DB_PASS 'root'
ENV PUB_KEY null
ENV POS_ID null
ENV POS_SHARE 'test'
ENV POST_TX 0

ENV PEER '95.216.246.116:8000'
ENV PORT 8000

ENV B_VAR $BUILDVAR

ENV SYNC_INTERVAL NaN
ENV LAG_INTERVAL NaN
ENV MINER_INSTANCES 1
ENV EXPLORER_INSTANCES 1

CMD if [ "$B_VAR" = "POW" ] ; then \
	pm2 start isyncer.js --name "syncer" -- --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS --id=$PUB_KEY --fastsync.lag_interval_b=$LAG_INTERVAL --fastsync.sync_interval_b=$SYNC_INTERVAL ;\
	pm2 start itransport.js --name "transport" -- --port=$PORT --peer=$PEER --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS --id=$PUB_KEY ;\
	pm2 start iminer.js --name "miner" -i $MINER_INSTANCES -- --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS --id=$PUB_KEY ;\
	pm2 start inodeapi.js --name "nodeapi" -- --enable_post_tx=$POST_TX --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS --id=$PUB_KEY ;\
	pm2-runtime icashier.js --name "cashier"  -- --cashier_interval_ms 10 --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS ;\
elif [ "$B_VAR" = "POS" ] ; then \
	pm2 start isyncer.js --name "syncer" -- --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS --id=$POS_ID --fastsync.lag_interval_b=$LAG_INTERVAL --fastsync.sync_interval_b=$SYNC_INTERVAL ;\
	pm2 start itransport.js --name "transport" -- --port=$PORT --peer=$PEER --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS --id=$POS_ID ;\
	pm2 start ilpos.js --name "miner" -- --pos_share=$POS_SHARE --leader_socket=$PEER --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS --id=$POS_ID ;\
	pm2 start inodeapi.js --name "nodeapi" -- --enable_post_tx=$POST_TX --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS --id=$POS_ID ;\
	pm2-runtime icashier.js --name "cashier"  -- --cashier_interval_ms 10 --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS ;\
elif [ "$B_VAR" = "FULLNODE" ] ; then \
	pm2 start isyncer.js --name "syncer" -- --id='fullnode' --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS --fastsync.lag_interval_b=$LAG_INTERVAL --fastsync.sync_interval_b=$SYNC_INTERVAL ;\
	pm2 start iexplorer.js --name "explorer" -i $EXPLORER_INSTANCES -- --id='fullnode' --explorer 80 --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS ;\
	pm2 start icashier.js --name "cashier"  -- --id='fullnode' --cashier_interval_ms 10 --indexer_mode 1 --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS ;\
	pm2 start itransport.js --name "transport" -- --id='fullnode' --port=$PORT --peer=$PEER --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS ;\
	pm2 start inodeapi.js --name "nodeapi" -- --enable_post_tx=$POST_TX --id='fullnode' --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS ;\
	pm2-runtime start istat.js --name "stat"  -- --dbhost=$DB_HOST --dbport=$DB_PORT --dbpass=$DB_PASS ;\
else \
	echo Error Bildvar = $B_VAR;\
fi 




