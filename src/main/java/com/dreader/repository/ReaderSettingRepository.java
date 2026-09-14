package com.dreader.repository;

import com.dreader.entity.ReaderSetting;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ReaderSettingRepository extends JpaRepository<ReaderSetting, Long> {
}
