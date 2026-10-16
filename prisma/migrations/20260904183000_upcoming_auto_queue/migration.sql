-- V3.15.0 - file d’attente automatique des nouveaux médias
ALTER TABLE `UpcomingRelease`
  MODIFY `availableAt` DATETIME(3) NULL,
  ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `sourceMediaItemId` VARCHAR(191) NULL,
  ADD COLUMN `sourceEpisodeId` VARCHAR(191) NULL,
  ADD COLUMN `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE UNIQUE INDEX `UpcomingRelease_sourceMediaItemId_key` ON `UpcomingRelease`(`sourceMediaItemId`);
CREATE UNIQUE INDEX `UpcomingRelease_sourceEpisodeId_key` ON `UpcomingRelease`(`sourceEpisodeId`);
CREATE INDEX `UpcomingRelease_status_availableAt_idx` ON `UpcomingRelease`(`status`, `availableAt`);

-- Les entrées déjà créées par V3.14 sont des programmations, pas des détections en attente.
UPDATE `UpcomingRelease` SET `status`='UPCOMING' WHERE `availableAt` IS NOT NULL;

CREATE TABLE `SystemSetting` (
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `SystemSetting` (`key`,`value`,`updatedAt`) VALUES ('AUTO_PUBLISH_NEW_MEDIA','false',CURRENT_TIMESTAMP(3));
