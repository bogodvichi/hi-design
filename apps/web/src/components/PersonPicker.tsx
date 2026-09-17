import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './PersonPicker.module.css';
import { useT } from '../i18n';

/**
 * 人员对象（来自 /uedro/web/user/v1/list）：{id,name,email,userDeptPath,...}。
 */
export interface Person {
  id: string;
  name: string;
  email?: string;
  userDeptPath?: string;
  [k: string]: any;
}

function truncateDeptPath(path: string): string {
  const parts = path.split('\\').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return parts.join('/');
  return '.../' + parts.slice(-2).join('/');
}

/**
 * 全局人员选择器：输入框 + 防抖查 /api/hik/uedro/userList，选中后把人员
 * 整个对象加入数组。对齐原站 personAdd：trigger-on-focus=false（必须输入才查）。
 *
 * 支持 `multiple` 参数控制单选 / 多选，默认单选。
 * - 多选：按 id 去重累加，X 按钮移除单个。
 * - 单选：选中即替换，X 按钮清空让用户重新选。
 *
 * 下拉结果里展示姓名 + 部门路径（辅助区分同名人员）；
 * 选中标签只显示姓名，不带部门信息。
 */
export function PersonPicker({
  selected,
  onChange,
  placeholder,
  multiple = false,
  onDuplicate,
  excludeEmails = [],
}: {
  selected: Person[];
  onChange: (p: Person[]) => void;
  placeholder?: string;
  multiple?: boolean;
  onDuplicate?: () => void;
  excludeEmails?: string[];
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(true);
  const reqIdRef = useRef(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const placeholderText = placeholder ?? t('personPicker.placeholder');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    aliveRef.current = true;
    if (!debounced) {
      setResults([]);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    fetch('/api/hik/uedro/userList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: debounced, pageNo: 1, pageSize: 30 }),
    })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (!aliveRef.current || reqId !== reqIdRef.current) return;
        const list: Person[] = Array.isArray(j?.data?.list) ? j.data.list : [];
        const filtered = excludeEmails.length
          ? list.filter((p) => {
              const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
              return !email || !excludeEmails.includes(email);
            })
          : list;
        setResults(filtered);
        setActiveIdx(0);
        setOpen(true);
      })
      .catch(() => {
        if (!aliveRef.current) return;
        setResults([]);
      })
      .finally(() => {
        if (aliveRef.current && reqId === reqIdRef.current) setLoading(false);
      });
    return () => {
      aliveRef.current = false;
    };
  }, [debounced]);

  // Position the portal dropdown below the input.
  useEffect(() => {
    if (!open || !inputRef.current) {
      setDropdownPos(null);
      return;
    }
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }, [open]);

  // Reposition on scroll/resize.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        !wrapRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function add(p: Person) {
    if (multiple) {
      if (selected.some((x) => x.id === p.id)) {
        onDuplicate?.();
      } else {
        onChange([...selected, p]);
      }
    } else {
      onChange([p]);
    }
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  function remove(idx: number) {
    if (multiple) {
      onChange(selected.filter((_, i) => i !== idx));
    } else {
      onChange([]);
    }
  }

  const emptyHint = multiple ? '选中的人员将显示在这里' : '选中的人员将显示在这里';

  return (
    <div className={styles.acWrap} ref={wrapRef}>
      {!multiple && selected.length > 0 ? (
        <div className={styles.acInputTag}>
          <span className={styles.tagName}>{selected[0]!.name}</span>
          <button
            type="button"
            className={styles.tagRemove}
            onClick={() => remove(0)}
            aria-label={`移除 ${selected[0]!.name}`}
          >
            ✕
          </button>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            className={styles.acInput}
            placeholder={placeholderText}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            onKeyDown={(e) => {
              if (!open || !results.length) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const p = results[activeIdx];
                if (p) add(p);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {loading ? <span className={styles.acSpinner} /> : null}
          {open && debounced && dropdownPos
            ? createPortal(
                <div
                  ref={dropdownRef}
                  className={styles.acDropdown}
                  style={{
                    position: 'fixed',
                    top: dropdownPos.top,
                    left: dropdownPos.left,
                    width: dropdownPos.width,
                  }}
                >
                  {!results.length ? (
                    <div className={styles.acEmpty}>无匹配人员</div>
                  ) : (
                    results.map((p, i) => (
                      <button
                        key={p.id ?? i}
                        type="button"
                        className={`${styles.acItem} ${i === activeIdx ? styles.acItemActive : ''}`}
                        onMouseEnter={() => setActiveIdx(i)}
                        onClick={() => add(p)}
                      >
                        <span className={styles.acItemName}>{p.name}</span>
                        {p.userDeptPath ? (
                          <span className={styles.acItemSub}>{truncateDeptPath(p.userDeptPath)}</span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>,
                document.body,
              )
            : null}
        </>
      )}
      {multiple ? (
        <div className={styles.selectedBox}>
          {!selected.length ? (
            <span className={styles.selectedEmpty}>{emptyHint}</span>
          ) : (
            selected.map((p, i) => (
            <span key={p.id ?? i} className={styles.tag}>
              <span className={styles.tagName}>{p.name}</span>
              <button
                type="button"
                className={styles.tagRemove}
                onClick={() => remove(i)}
                aria-label={`移除 ${p.name}`}
              >
                ✕
              </button>
            </span>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
