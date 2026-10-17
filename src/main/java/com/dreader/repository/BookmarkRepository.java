package com.dreader.repository;

import com.dreader.entity.Bookmark;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface BookmarkRepository extends JpaRepository<Bookmark, Long> {
    List<Bookmark> findByBookId(Long bookId);
    void deleteByBookId(Long bookId);
}
