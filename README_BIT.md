# Node-main

Node-main is a part of Enecuum's blockchain protocol. It is a Fullnode with the Blockchain Explorer functionality. 

## What is this project?

[Enecuum](https://enecuum.com/) is a Blockchain Mobile Network for decentralized application. We create a decentralized ecosystem able to bring the blockchain and cryptocurrencies to the real mainstream, involving a crowd with regular mobile and desktop devices into the blockchain network, as well as providing the powerful toolkit for the dApps developers to create fast and low cost applications for millions of people.

To help new people with understanding our products, Enecuum maintains a [Vuepress-powered](https://vuepress.vuejs.org) website with tutorials, [Enecuum User Guides.](https://guides.enecuum.com/)

# Run Fullnode

## Prerequisites 

You need a public IP to run Fullnode.

Make sure you have the following installed.

MySQL:

```
sudo apt install mysql-server -y
```

NodeJS:

```sh
curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
sudo apt-get install -y nodejs
```

PM2:

```
sudo npm i -g pm2
```

## Install

1. Install the packages: 

   ```
   npm i
   ```

2. Initialize DB:

   ```
   mysql -uroot -e "DROP DATABASE IF EXISTS trinity; CREATE DATABASE trinity;"
   ```

3. Create DB schema from dump:

   ```
   mysql -uroot trinity < sql/db.sql
   ```

## Configure 

Before proceeding, make sure you have a public IP to run Fullnode.

1. Create a copy of `config.bit` and name it `config.json`. 

   ```
   cp config.bit config.json
   ```
   
2. In `config.json`, set the `dbport`, `dbuser` according to your MySQL settings. You can also specify `dbhost` property if it is not `localhost`.

3. Create a copy of ecosystem file. 

   Fullnode:
   ```
   cp pm2/fullnode.config.example pm2/fullnode.config.js
   ```
   PoW:
   ```
   cp pm2/pow.config.example pm2/pow.config.js
   ```
   PoS:
   ```
   cp pm2/pos.config.example pm2/pos.config.js
   ```
   
4. Optionally, in `pm2/fullnode.config.js, pm2/pow.config.example, pm2/pos.config.example`, change the following ports:

   - In `miner, syncer, nodeapi, transport` section:
      - set the `--id` as of your PoS contract id:
           
        ```
        --id <your PoS contract id>
        ```
    	   
   - In `explorer` section:
        - set the `--explorer` as one of your open ports for your Blockchain Explorer:
        
       	 ```
       	 --explorer 80
       	 ```
       	    	   
       To turn off the Explorer, just remove the `--explorer 80` key from arguments list.

   - In `transport` section:
     - set the `--peer` as an existing Enecuum BIT node IP address, preferably the Enecuum BIT LPoS IP address:

       ```
       --peer=95.216.246.116:7000
       ```
       
     - set the `--port` as one of your open ports for other's nodes sync, preferably `7000`:
	 
       ```
       --port=7000
       ```

5. To run Explorer, make a copy of `explorer/config-bit.js` and name it `explorer/config.js`. 
                         
    ```
    cp explorer/config-bit.js explorer/config.js
    ```


## Start

Start Fullnode:
```
pm2 start pm2/fullnode.config.js
```

Start PoW:
```
pm2 start pm2/pow.config.js
```

Start PoS:
```
pm2 start pm2/pos.config.js
```



## Check

To check if your node is successfully running, you can optionally do the following.

1. Open MySQL command line:

   ```
   mysql -u root -p
   ```

2. Check if your node is synchronizing:

   Use the appropriate database name in the query
   ```
   select count(*) from trinity.kblocks;
   ```

Alternatively, if you enable explorer in the config file, you can access it via your browser with the specified port number.

## Stop

To stop the process, use the following:
```
pm2 stop <process name | id>
pm2 delete <process name | id>
```

# Contribution

See [Contributing.](CONTRIBUTING.md)

# License

[MIT](LICENSE.md)
