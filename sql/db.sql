-- MySQL dump 10.13  Distrib 5.7.24, for Win64 (x86_64)
--
-- Host: localhost    Database: trinity
-- ------------------------------------------------------
-- Server version	5.7.24

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `agents`
--

DROP TABLE IF EXISTS `agents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `agents` (
  `id` varchar(66) NOT NULL,
  `ref_count` int(11) DEFAULT NULL,
  `ref_reward` bigint(20) DEFAULT NULL,
  `k_reward` bigint(20) DEFAULT NULL,
  `s_reward` bigint(20) DEFAULT NULL,
  `lastcalc` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `clients`
--

DROP TABLE IF EXISTS `clients`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `clients` (
  `ipstring` varchar(39) CHARACTER SET latin1 NOT NULL,
  `pub` varchar(66) CHARACTER SET latin1 DEFAULT NULL,
  `count` int(11) DEFAULT NULL,
  `type` int(11) DEFAULT NULL,
  PRIMARY KEY (`ipstring`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `delegates`
--

DROP TABLE IF EXISTS `delegates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `delegates` (
  `pos_id` varchar(64) NOT NULL,
  `delegator` varchar(66) NOT NULL,
  `amount` bigint(20) unsigned DEFAULT NULL,
  `reward` bigint(20) unsigned DEFAULT '0',
  PRIMARY KEY (`pos_id`,`delegator`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `dex_pools`;
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

DROP TABLE IF EXISTS `farms`;
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


DROP TABLE IF EXISTS `farmers`;
CREATE TABLE `farmers` (
  `farm_id` VARCHAR(64) NOT NULL,
  `farmer_id` VARCHAR(66) NOT NULL,
  `stake` BIGINT(20) NULL,
  `level` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`farm_id`, `farmer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Table structure for table `snapshots`
--

DROP TABLE IF EXISTS `snapshots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `snapshots` (
  `hash` varchar(64) CHARACTER SET latin1 NOT NULL,
  `kblocks_hash` varchar(64) NOT NULL,
  `data` LONGBLOB DEFAULT NULL,
  PRIMARY KEY (`hash`,`kblocks_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT='  ';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `eindex`
--

DROP TABLE IF EXISTS `eindex`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `eindex` (
  `id` varchar(66) CHARACTER SET latin1 NOT NULL,
  `hash` varchar(64) CHARACTER SET latin1 NOT NULL,
  `time` int(11) DEFAULT NULL,
  `iin` bigint(20) DEFAULT NULL,
  `iout` bigint(20) DEFAULT NULL,
  `ik` bigint(20) DEFAULT NULL,
  `im` bigint(20) DEFAULT NULL,
  `istat` bigint(20) DEFAULT NULL,
  `iref` bigint(20) DEFAULT NULL,
  `i` bigint(20) DEFAULT NULL,
  `irew` bigint(20) DEFAULT NULL,
  `itx` bigint(20) DEFAULT NULL,
  `rectype` varchar(30) DEFAULT NULL,
  `value` bigint(20) unsigned DEFAULT NULL,
  KEY `i_id` (`id`),
  KEY `i_i` (`id`,`i`),
  KEY `i_in` (`id`,`iin`),
  KEY `i_out` (`id`,`iout`),
  KEY `i_k` (`id`,`ik`),
  KEY `i_m` (`id`,`im`),
  KEY `i_s` (`id`,`istat`),
  KEY `i_ref` (`id`,`iref`),
  KEY `i_rew` (`id`,`irew`),
  KEY `i_tx` (`id`,`itx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT='  ';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `iptable`
--

DROP TABLE IF EXISTS `iptable`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `iptable` (
  `ipstring` varchar(39) CHARACTER SET latin1 NOT NULL,
  `country` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lat` double DEFAULT NULL,
  `lon` double DEFAULT NULL,
  `country_code` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`ipstring`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kblocks`
--

DROP TABLE IF EXISTS `kblocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `kblocks` (
  `hash` varchar(64) NOT NULL,
  `n` int(21) NOT NULL,
  `time` int(11) NOT NULL,
  `publisher` varchar(66) NOT NULL,
  `nonce` int(11) NOT NULL,
  `link` varchar(64) NOT NULL,
  `sprout` varchar(64) NOT NULL,
  `m_root` varchar(64) NOT NULL,
  `leader_sign` BLOB NULL,
  `reward` bigint(20) DEFAULT NULL,
  `target_diff` int(16) DEFAULT '10',
  PRIMARY KEY (`hash`),
  UNIQUE KEY `sprout` (`n`,`sprout`),
  KEY `spr_idx` (`sprout`),
  KEY `link_idx` (`link`),
  CONSTRAINT `kblocks_ibfk_1` FOREIGN KEY (`link`) REFERENCES `kblocks` (`hash`),
  CONSTRAINT `spr` FOREIGN KEY (`sprout`) REFERENCES `sprouts` (`sprout`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ledger`
--

DROP TABLE IF EXISTS `ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ledger` (
  `id` varchar(130) CHARACTER SET latin1 NOT NULL,
  `amount` bigint(20) unsigned DEFAULT NULL,
  `token` varchar(64) NOT NULL,
  PRIMARY KEY (`id`,`token`),
  KEY `i_amount` (`amount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mblocks`
--

DROP TABLE IF EXISTS `mblocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `mblocks` (
  `hash` varchar(64) NOT NULL,
  `kblocks_hash` varchar(64) NOT NULL,
  `publisher` varchar(66) NOT NULL,
  `reward` bigint(20) DEFAULT NULL,
  `nonce` bigint(20) NOT NULL,
  `sign` varchar(150) NOT NULL,
  `leader_sign` BLOB NULL,
  `token` varchar(64) NOT NULL,
  `included` tinyint(4) DEFAULT '0',
  `calculated` tinyint(4) DEFAULT '0',
  `indexed` tinyint(4) DEFAULT '0',
  `referrer` varchar(66) DEFAULT NULL,
  PRIMARY KEY (`hash`,`kblocks_hash`),
  KEY `fk_mblocks_kblocks_idx` (`kblocks_hash`),
  KEY `i_publisher` (`publisher`),
  CONSTRAINT `fk_mblocks_kblocks` FOREIGN KEY (`kblocks_hash`) REFERENCES `kblocks` (`hash`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pending`
--

DROP TABLE IF EXISTS `pending`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pending` (
  `hash` varchar(64) CHARACTER SET latin1 NOT NULL,
  `from` varchar(66) CHARACTER SET latin1 NOT NULL,
  `to` varchar(66) CHARACTER SET latin1 NOT NULL,
  `amount` bigint(20) unsigned NOT NULL,
  `nonce` bigint(20) NOT NULL,
  `sign` varchar(150) CHARACTER SET latin1 NOT NULL,
  `timeadded` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `counter` int(11) DEFAULT '0',
  `lastrequested` timestamp NULL DEFAULT NULL,
  `uid` bigint(20) DEFAULT NULL,
  `ticker` varchar(64) COLLATE utf8_bin DEFAULT NULL,
  `data` varchar(512) COLLATE utf8_bin DEFAULT NULL,
  PRIMARY KEY (`hash`),
  UNIQUE KEY `hash_UNIQUE` (`hash`)
) ENGINE=MEMORY DEFAULT CHARSET=utf8 COLLATE=utf8_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `poalist`
--

DROP TABLE IF EXISTS `poalist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `poalist` (
  `id` bigint(20) NOT NULL,
  `pubkey` varchar(66) CHARACTER SET latin1 DEFAULT NULL,
  `ip` varchar(39) CHARACTER SET latin1 DEFAULT NULL,
  `online` tinyint(4) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `poses`
--

DROP TABLE IF EXISTS `poses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `poses` (
  `id` varchar(64) NOT NULL,
  `owner` varchar(66) DEFAULT NULL,
  `fee` int(11) DEFAULT NULL,
  `name` varchar(40) CHARACTER SET utf8 DEFAULT NULL,
  `uptime` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rois`
--

DROP TABLE IF EXISTS `rois`;
CREATE TABLE `rois` (
  `token` varchar(64) NOT NULL,
  `calc_stakes` varchar(512) DEFAULT NULL,
  `calc_rois` varchar(512) DEFAULT NULL,
  `calc_rois_sim` varchar(512) DEFAULT NULL,
  PRIMARY KEY (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Table structure for table `sblocks`
--

DROP TABLE IF EXISTS `sblocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sblocks` (
  `hash` varchar(64) NOT NULL,
  `kblocks_hash` varchar(64) NOT NULL,
  `publisher` varchar(66) NOT NULL,
  `reward` bigint(20) DEFAULT NULL,
  `sign` varchar(150) NOT NULL,
  `included` tinyint(4) DEFAULT '0',
  `calculated` tinyint(4) DEFAULT '0',
  `indexed` tinyint(4) DEFAULT '0',
  `bulletin` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`hash`,`kblocks_hash`),
  KEY `fk_sblocks_kblocks_idx` (`kblocks_hash`),
  CONSTRAINT `fk_sblocks_kblocks` FOREIGN KEY (`kblocks_hash`) REFERENCES `kblocks` (`hash`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sprouts`
--

DROP TABLE IF EXISTS `sprouts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sprouts` (
  `sprout` varchar(64) NOT NULL,
  `fork` varchar(64) DEFAULT NULL,
  `n` int(20) DEFAULT NULL,
  `branch` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`sprout`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stat`
--

DROP TABLE IF EXISTS `stat`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stat` (
  `key` varchar(64) NOT NULL,
  `value` varchar(512) DEFAULT NULL,
  `calctime` int(11) DEFAULT NULL,
  `lifetime` int(11) DEFAULT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tokens`
--

DROP TABLE IF EXISTS `tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tokens` (
  `hash` varchar(64) NOT NULL,
  `owner` varchar(66) NOT NULL,
  `fee_type` int(11) unsigned NOT NULL DEFAULT '0',
  `fee_value` bigint(20) unsigned NOT NULL DEFAULT '0',
  `fee_min` bigint(20) unsigned DEFAULT NULL,
  `ticker` varchar(10) DEFAULT NULL,
  `decimals` int(11) unsigned DEFAULT '10',
  `total_supply` bigint(20) unsigned DEFAULT NULL,
  `caption` varchar(150) CHARACTER SET utf8 DEFAULT NULL,
  `active` int(11) DEFAULT '0',
  `reissuable` tinyint(1) unsigned DEFAULT '0',
  `minable` tinyint(1) unsigned DEFAULT '0',
  `max_supply` bigint(20) unsigned DEFAULT NULL,
  `block_reward` bigint(20) unsigned DEFAULT NULL,
  `min_stake` bigint(20) unsigned DEFAULT NULL,
  `referrer_stake` bigint(20) unsigned DEFAULT NULL,
  `ref_share` int(11) unsigned DEFAULT NULL,
  PRIMARY KEY (`hash`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tokens_index`
--

DROP TABLE IF EXISTS `tokens_index`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tokens_index` (
  `hash` varchar(64) NOT NULL,
  `txs_count` bigint(20) DEFAULT '1',
  PRIMARY KEY (`hash`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tokens_price`
--

DROP TABLE IF EXISTS `tokens_price`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tokens_price` (
  `tokens_hash` varchar(64) NOT NULL,
  `cg_id` varchar(64) NOT NULL,
  `price` bigint(20) NOT NULL,
  PRIMARY KEY (`tokens_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `transactions`
--

DROP TABLE IF EXISTS `transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `transactions` (
  `hash` varchar(64) NOT NULL,
  `from` varchar(66) NOT NULL,
  `to` varchar(66) NOT NULL,
  `amount` bigint(20) unsigned NOT NULL,
  `mblocks_hash` varchar(64) NOT NULL,
  `nonce` bigint(20) NOT NULL,
  `status` int(11) DEFAULT NULL,
  `sign` varchar(150) DEFAULT NULL,
  `ticker` varchar(64) NOT NULL,
  `data` varchar(512) DEFAULT NULL,
  PRIMARY KEY (`hash`,`mblocks_hash`),
  KEY `fk_transactions_mblocks1_idx` (`mblocks_hash`),
  KEY `i_from` (`from`),
  KEY `i_to` (`to`),
  KEY `i_hash` (`hash`),
  CONSTRAINT `fk_transactions_mblocks1` FOREIGN KEY (`mblocks_hash`) REFERENCES `mblocks` (`hash`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `txs_data`
--

DROP TABLE IF EXISTS `txs_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `txs_data` (
  `chunk_id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `data` varchar(256) DEFAULT NULL,
  `next_chunk` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`chunk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `undelegates`
--

DROP TABLE IF EXISTS `undelegates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `undelegates` (
  `id` varchar(64) NOT NULL,
  `delegator` varchar(66) DEFAULT NULL,
  `pos_id` varchar(64) DEFAULT NULL,
  `amount` bigint(20) unsigned DEFAULT NULL,
  `height` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2020-04-14 15:09:51
