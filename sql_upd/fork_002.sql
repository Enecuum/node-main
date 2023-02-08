CREATE TABLE `dex_pools` (
  `pair_id` VARCHAR(128) NOT NULL,
  `asset_1` VARCHAR(64) NOT NULL,
  `volume_1` BIGINT(20) UNSIGNED NULL,
  `asset_2` VARCHAR(64) NOT NULL,
  `volume_2` BIGINT(20) UNSIGNED NULL,
  `pool_fee` BIGINT(20) UNSIGNED NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`pair_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `farms` (
  `farm_id` VARCHAR(64) NOT NULL,
  `stake_token` VARCHAR(64) NOT NULL,
  `reward_token` VARCHAR(64) NOT NULL,
  `emission` BIGINT(20)  UNSIGNED NULL,
  `block_reward` BIGINT(20) UNSIGNED NULL,
  `level` VARCHAR(64) NOT NULL,
  `total_stake` BIGINT(20) UNSIGNED NULL,
  `last_block` BIGINT(20) DEFAULT NULL,
  `accumulator` BIGINT(20) UNSIGNED DEFAULT 0,
  PRIMARY KEY (`farm_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `farmers` (
  `farm_id` VARCHAR(64) NOT NULL,
  `farmer_id` VARCHAR(66) NOT NULL,
  `stake` BIGINT(20) NULL,
  `level` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`farm_id`, `farmer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `tmp_snapshots` (
  `hash` varchar(64) CHARACTER SET latin1 NOT NULL,
  `kblocks_hash` varchar(64) NOT NULL,
  `data` LONGBLOB DEFAULT NULL,
  PRIMARY KEY (`hash`,`kblocks_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT='  ';

ALTER TABLE `kblocks`
ADD COLUMN `leader_sign` BLOB NULL AFTER `m_root`;

ALTER TABLE `trinity`.`ledger` 
CHANGE COLUMN `token` `token` VARCHAR(64) NOT NULL ;

ALTER TABLE `trinity`.`mblocks` 
CHANGE COLUMN `leader_sign` `leader_sign` BLOB NULL ,
CHANGE COLUMN `token` `token` VARCHAR(64) NOT NULL ;

ALTER TABLE `trinity`.`tokens` 
DROP INDEX `ticker_UNIQUE` ;

CREATE TABLE `tokens_price` (
  `tokens_hash` varchar(64) NOT NULL,
  `cg_id` varchar(64),
  `cg_price` bigint(20),
  `dex_price` bigint(20),
  `decimals` int(11) unsigned DEFAULT '10',
  PRIMARY KEY (`tokens_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

ALTER TABLE `trinity`.`transactions` 
CHANGE COLUMN `ticker` `ticker` VARCHAR(64) NULL ;

ALTER TABLE `trinity`.`undelegates` 
ADD COLUMN `delegator` varchar(66) DEFAULT NULL AFTER `id`;


