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
import { isAbsent, type JsonValue } from './merge/types';
import type { CompiledSchema } from './merge/schema';

type Stage = 'input' | 'merge' | 'output';

export default function App() {
  const [stage, setStage] = useState<Stage>('input');
  const [baseDoc, setBaseDoc] = useState<JsonValue | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [merged, setMerged] = useState<JsonValue | null>(null);
  const [patch, setPatch] = useState<PatchOp[]>([]);
  // Schema 校验状态在「返回调整 ↔ 输出」之间保留，重新开始时清空
  const [schemaEnabled, setSchemaEnabled] = useState(false);
  const [schema, setSchema] = useState<CompiledSchema | null>(null);

  const handleMerge = (base: JsonValue, ours: JsonValue, theirs: JsonValue) => {
    setBaseDoc(base);
    setMergeResult(threeWayMerge(base, ours, theirs));
    setResolutions({});
    setMerged(null);
    setPatch([]);
    setStage('merge');
  };

  const handleFinish = () => {
    if (!mergeResult || baseDoc === null) return;
    const result = buildMerged(mergeResult.root, resolutions);
    if (result === undefined || isAbsent(result)) return;
    setMerged(result);
    setPatch(diff(baseDoc, result));
    setStage('output');
  };

  const handleRestart = () => {
    setStage('input');
    setMergeResult(null);
    setBaseDoc(null);
    setResolutions({});
    setMerged(null);
    setPatch([]);
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
        {stage === 'input' && <InputStage onMerge={handleMerge} />}
        {stage === 'merge' && mergeResult && (
          <MergeStage
            mergeResult={mergeResult}
            resolutions={resolutions}
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
