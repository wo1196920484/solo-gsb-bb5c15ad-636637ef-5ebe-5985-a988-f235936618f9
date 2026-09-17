import { useState } from 'react';
import InputStage from './components/InputStage';
import MergeStage from './components/MergeStage';
import OutputStage from './components/OutputStage';
import { diff, type PatchOp } from './merge/rfc6902';
import {
  buildMerged,
  threeWayMerge,
  type MergeResult,
  type Resolutions,
} from './merge/threeWayMerge';
import { restoreResolutions, type ParsedSnapshot, type RestoreResult } from './merge/snapshot';
import { isAbsent, type JsonValue } from './merge/types';
import type { CompiledSchema } from './merge/schema';

type Stage = 'input' | 'merge' | 'output';

interface Sources {
  base: JsonValue;
  ours: JsonValue;
  theirs: JsonValue;
}

export default function App() {
  const [stage, setStage] = useState<Stage>('input');
  const [sources, setSources] = useState<Sources | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [merged, setMerged] = useState<JsonValue | null>(null);
  const [patch, setPatch] = useState<PatchOp[]>([]);
  // 快照导入的恢复汇总（进入合并页展示一次，可关闭）
  const [restoreSummary, setRestoreSummary] = useState<RestoreResult | null>(null);
  // Schema 校验状态在「返回调整 ↔ 输出」之间保留，重新开始时清空
  const [schemaEnabled, setSchemaEnabled] = useState(false);
  const [schema, setSchema] = useState<CompiledSchema | null>(null);

  const handleMerge = (base: JsonValue, ours: JsonValue, theirs: JsonValue) => {
    setSources({ base, ours, theirs });
    setMergeResult(threeWayMerge(base, ours, theirs));
    setResolutions({});
    setMerged(null);
    setPatch([]);
    setRestoreSummary(null);
    setStage('merge');
  };

  // 导入会话快照：重新执行三方合并，再按指针 + 三方值匹配恢复已选解决方案
  const handleImportSnapshot = (snapshot: ParsedSnapshot) => {
    const result = threeWayMerge(snapshot.sources.base, snapshot.sources.ours, snapshot.sources.theirs);
    const restore = restoreResolutions(snapshot, result);
    setSources(snapshot.sources);
    setMergeResult(result);
    setResolutions(restore.resolutions);
    setMerged(null);
    setPatch([]);
    setRestoreSummary(restore);
    setStage('merge');
  };

  const handleFinish = () => {
    if (!mergeResult || !sources) return;
    const result = buildMerged(mergeResult.root, resolutions);
    if (result === undefined || isAbsent(result)) return;
    setMerged(result);
    setPatch(diff(sources.base, result));
    setRestoreSummary(null); // 恢复汇总只在进入合并页时展示一次
    setStage('output');
  };

  const handleRestart = () => {
    setStage('input');
    setMergeResult(null);
    setSources(null);
    setResolutions({});
    setMerged(null);
    setPatch([]);
    setRestoreSummary(null);
    setSchema(null);
    setSchemaEnabled(false);
  };

  return (
    <>
      <header className="app-header">
        <h1>JSON 三方合并台</h1>
        <div className="steps">
          <span className={`step ${stage === 'input' ? 'active' : 'done'}`}>1 输入三份 JSON</span>
          <span className={`step ${stage === 'merge' ? 'active' : stage === 'output' ? 'done' : ''}`}>
            2 解决冲突
          </span>
          <span className={`step ${stage === 'output' ? 'active' : ''}`}>3 导出结果</span>
        </div>
      </header>
      <main>
        {stage === 'input' && (
          <InputStage onMerge={handleMerge} onImportSnapshot={handleImportSnapshot} />
        )}
        {stage === 'merge' && mergeResult && sources && (
          <MergeStage
            mergeResult={mergeResult}
            sources={sources}
            resolutions={resolutions}
            restoreSummary={restoreSummary}
            onDismissRestoreSummary={() => setRestoreSummary(null)}
            onResolutionsChange={setResolutions}
            onFinish={handleFinish}
            onBack={handleRestart}
          />
        )}
        {stage === 'output' && merged !== null && (
          <OutputStage
            merged={merged}
            patch={patch}
            schemaEnabled={schemaEnabled}
            schema={schema}
            onSchemaEnabledChange={setSchemaEnabled}
            onSchemaChange={setSchema}
            onBack={() => setStage('merge')}
            onRestart={handleRestart}
          />
        )}
      </main>
    </>
  );
}
