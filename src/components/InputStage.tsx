import { useState } from 'react';
import JsonInputPanel from './JsonInputPanel';
import type { JsonValue } from '../merge/types';
import { SAMPLE_BASE, SAMPLE_OURS, SAMPLE_THEIRS } from '../sampleData';

interface Props {
  onMerge: (base: JsonValue, ours: JsonValue, theirs: JsonValue) => void;
}

type Field = 'base' | 'ours' | 'theirs';

const PANELS: { field: Field; title: string; hint: string }[] = [
  { field: 'base', title: '基线 (Base)', hint: '三方共同的祖先版本' },
  { field: 'ours', title: '当前分支 (Ours)', hint: '当前分支上的修改版本' },
  { field: 'theirs', title: '目标分支 (Theirs)', hint: '需要合入的目标分支版本' },
];

export default function InputStage({ onMerge }: Props) {
  const [texts, setTexts] = useState<Record<Field, string>>({ base: '', ours: '', theirs: '' });
  const [errors, setErrors] = useState<Record<Field, string | null>>({
    base: null,
    ours: null,
    theirs: null,
  });

  const setText = (field: Field) => (v: string) => {
    setTexts((t) => ({ ...t, [field]: v }));
    setErrors((e) => ({ ...e, [field]: null }));
  };

  const handleStart = () => {
    const parsed: Partial<Record<Field, JsonValue>> = {};
    const newErrors: Record<Field, string | null> = { base: null, ours: null, theirs: null };
    let ok = true;
    for (const { field } of PANELS) {
      try {
        parsed[field] = JSON.parse(texts[field]) as JsonValue;
      } catch (err) {
        newErrors[field] = err instanceof Error ? err.message : String(err);
        ok = false;
      }
    }
    setErrors(newErrors);
    if (ok) onMerge(parsed.base!, parsed.ours!, parsed.theirs!);
  };

  const loadSample = () => {
    setTexts({ base: SAMPLE_BASE, ours: SAMPLE_OURS, theirs: SAMPLE_THEIRS });
    setErrors({ base: null, ours: null, theirs: null });
  };

  return (
    <>
      <div className="input-grid">
        {PANELS.map(({ field, title, hint }) => (
          <JsonInputPanel
            key={field}
            title={title}
            hint={hint}
            value={texts[field]}
            error={errors[field]}
            onChange={setText(field)}
          />
        ))}
      </div>
      <div className="input-actions">
        <button onClick={loadSample}>加载示例数据</button>
        <div className="spacer" />
        <button
          className="primary"
          onClick={handleStart}
          disabled={!texts.base.trim() || !texts.ours.trim() || !texts.theirs.trim()}
        >
          开始合并 →
        </button>
      </div>
    </>
  );
}
