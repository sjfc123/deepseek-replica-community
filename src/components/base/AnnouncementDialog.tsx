/* ============================================================================
 * 功能区：基础 UI / AnnouncementDialog 开始
 * 职责：AnnouncementDialog 组件，负责该组件的渲染、状态与交互出口。
 * 导出：AnnouncementDialog。
 * ========================================================================== */

import { useEffect, useState } from 'react'
import {
  ANNOUNCEMENT,
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_ID,
  type AnnouncementCategory,
} from '../../app/announcement.js'
import styles from './AnnouncementDialog.module.css'

const KEY = `replica:announcement:${ANNOUNCEMENT_ID}`

type Filter = AnnouncementCategory | 'all'

/** 分类顺序固定，筛选栏与分组标签共用 */
const CATEGORY_ORDER: AnnouncementCategory[] = ['new', 'opt', 'fix', 'note']

/** 启动公告：首次启动当前版本时弹一次；设置页可重新打开 */
export const AnnouncementDialog = () => {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    let seen = false
    try {
      seen = window.localStorage.getItem(KEY) === '1'
    } catch {
      seen = false
    }
    if (!seen) {
      setOpen(true)
    }
    const reopen = () => setOpen(true)
    window.addEventListener('replica:show-announcement', reopen)
    return () => window.removeEventListener('replica:show-announcement', reopen)
  }, [])

  if (!open) {
    return null
  }

  const close = () => {
    setOpen(false)
    try {
      window.localStorage.setItem(KEY, '1')
    } catch {
      // 存不进去就下次再弹，不影响使用
    }
  }

  const total = ANNOUNCEMENT.sections.reduce((sum, section) => sum + section.items.length, 0)
  const day = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  const counts: Record<AnnouncementCategory, number> = { new: 0, opt: 0, fix: 0, note: 0 }
  ANNOUNCEMENT.sections.forEach((section) => {
    counts[section.category] += section.items.length
  })
  const visibleSections =
    filter === 'all'
      ? ANNOUNCEMENT.sections
      : ANNOUNCEMENT.sections.filter((section) => section.category === filter)
  const visibleCount = visibleSections.reduce((sum, section) => sum + section.items.length, 0)

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={ANNOUNCEMENT.title}>
      <section className={styles.card}>
        <header className={styles.hero}>
          <span className={styles.badge}>更新</span>
          <div className={styles.heroText}>
            <h2>{ANNOUNCEMENT.title}</h2>
            <p>
              {day} · 共 {total} 条变化
            </p>
          </div>
          <span className={styles.version}>{ANNOUNCEMENT.version}</span>
        </header>

        <div className={styles.body}>
          <p className={styles.intro}>{ANNOUNCEMENT.intro}</p>

          <div className={styles.warning}>
            <div className={styles.warningHead}>
              <span className={styles.warningIcon} aria-hidden="true">
                !
              </span>
              <h3>{ANNOUNCEMENT.warningTitle}</h3>
            </div>
            <p className={styles.warningLead}>{ANNOUNCEMENT.warningLead}</p>
            <ul>
              {ANNOUNCEMENT.warning.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div className={styles.filters} role="tablist" aria-label="按分类筛选公告">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              className={styles.filter}
              data-on={filter === 'all' ? '' : undefined}
              onClick={() => setFilter('all')}
            >
              全部
              <span>{total}</span>
            </button>
            {CATEGORY_ORDER.map((category) => (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={filter === category}
                className={styles.filter}
                data-tone={category}
                data-on={filter === category ? '' : undefined}
                onClick={() => setFilter(category)}
              >
                {ANNOUNCEMENT_CATEGORIES[category].label}
                <span>{counts[category]}</span>
              </button>
            ))}
          </div>
          <p className={styles.filterHint}>
            {filter === 'all'
              ? `共 ${total} 条，按新增、优化、修复、说明归组`
              : `${ANNOUNCEMENT_CATEGORIES[filter].hint}，共 ${visibleCount} 条`}
          </p>

          <div className={styles.sections}>
            {visibleSections.map((section) => (
              <article
                className={styles.section}
                data-tone={section.category}
                data-wide={section.items.length >= 8 ? 'true' : undefined}
                key={section.heading}
              >
                <h3>
                  <span className={styles.sectionTag} data-tone={section.category}>
                    {ANNOUNCEMENT_CATEGORIES[section.category].label}
                  </span>
                  {section.heading}
                  <span className={styles.sectionCount}>{section.items.length}</span>
                </h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <p className={styles.wish}>{ANNOUNCEMENT.wish}</p>
        </div>

        <div className={styles.footer}>
          <button className={styles.confirm} type="button" onClick={close}>
            我已阅读并知晓
          </button>
          <p className={styles.footHint}>每个版本首次启动只弹一次，设置里可随时重看</p>
        </div>
      </section>
    </div>
  )
}

/* ============================================================================
 * 功能区：基础 UI / AnnouncementDialog 结束
 * ========================================================================== */
