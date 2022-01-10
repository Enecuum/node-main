-- MySQL dump 10.13  Distrib 8.0.17, for Win64 (x86_64)
--
-- Host: localhost    Database: trinity
-- ------------------------------------------------------
-- Server version	5.7.26-0ubuntu0.18.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `stat`
--

DROP TABLE IF EXISTS `stat`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stat` (
  `key` varchar(64) NOT NULL,
  `value` varchar(512) DEFAULT NULL,
  `calctime` int(11) DEFAULT NULL,
  `lifetime` int(11) DEFAULT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `stat`
--

LOCK TABLES `stat` WRITE;
/*!40000 ALTER TABLE `stat` DISABLE KEYS */;
INSERT INTO `stat` VALUES 

('apkUrl','https://app.enecuum.com/',NULL,NULL),
('calc_rois','253148287536;1265743995736;2536875763486;12659469266887;25333289606241;126379711624222;252112995746709',NULL,NULL),
('calc_stakes','250000000000;1250000000000;2500000000000;12500000000000;25000000000000;125000000000000;250000000000000',NULL,NULL),
('max_stake','250000000000000',NULL,NULL),
('maxApkVersion','0.9.26',NULL,NULL),
('min_stake','250000000000',NULL,NULL),
('minApkVersion','0.9.26',NULL,NULL),
('referrer_stake','10000000000000',NULL,NULL),

('accounts','20',1567438063,NULL),
('block_time_24h_avg','0',1567438063,3600),
('block_time_30d_avg','0',1567438063,3600),
('block_time_target','0',1567438063,3600),
('cg_btc',NULL,1567438063,30),
('cg_eth',NULL,1567438063,30),
('cg_usd',NULL,1567438063,30),
('csup','0',1567438063,15),
('difficulty',NULL,0,1800),
('engaged_balance','0',1567438063,60),
('full_count',NULL,1567438063,600),
('height',NULL,1567438063,15),
('max_tps','3',1567438063,3600),
('network_hashrate',NULL,0,3600),
('poa_capable_count','0',1567438063,600),
('poa_count','1',1567438063,600),
('pos_active_count','0',1567438063,600),
('pos_count',NULL,1567438063,600),
('pos_total_count','0',1567438063,600),
('pow_count',NULL,1567438063,600),
('proposed_inflation','0',1567438063,15),
('reward_poa',NULL,1567438063,15),
('reward_pos',NULL,1567438063,15),
('reward_pow',NULL,1567438063,15),
('total_daily_pos_stake','0',1567438063,60),
('total_daily_stake','0',1567438063,60),
('tps','0',1567438063,15),
('tsup','0',1567438063,15),
('txfee_daily_30d_avg','0',1567438063,15),
('txfee_hourly_24h_avg','0',1567438063,15),
('update_iptable',NULL,1567438063,15);
/*!40000 ALTER TABLE `stat` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2019-09-02 18:37:11
