import React, { useId } from 'react';
import {
  type DecisionsReviewFormState,
} from "./decisions-contracts";

export function DecisionsWritableTargetForm(props: {
  disabled: boolean;
  disabledReason?: string;
  form: DecisionsReviewFormState;
  mode: 'binding' | 'review';
  sourceFiles: string[];
  setForm: React.Dispatch<React.SetStateAction<DecisionsReviewFormState>>;
}) {
  const { disabled, disabledReason, form, mode, setForm, sourceFiles } = props;
  const reasonId = useId();
  return (
    <fieldset aria-describedby={disabled ? reasonId : undefined} className="decisions-review-form" disabled={disabled}>
      {disabled && <p id={reasonId}>{disabledReason || '正在处理当前建议，请等待本次操作完成后填写。'}</p>}
      <legend>{mode === 'review' ? '人工复核与 Ads 可写对象身份' : 'Ads 可写对象身份核验'}</legend>
      <label>
        <span>{mode === 'review' ? '复核人' : '核验人'}</span>
        <input
          autoComplete="name"
          onChange={(event) => setForm((current) => ({
            ...current,
            reviewedBy: event.target.value,
          }))}
          placeholder="填写姓名"
          value={form.reviewedBy}
        />
      </label>
      <label>
        <span>{mode === 'review' ? '复核依据 / 拒绝原因' : '对象绑定说明'}</span>
        <textarea
          onChange={(event) => setForm((current) => ({
            ...current,
            rationale: event.target.value,
          }))}
          placeholder={mode === 'review'
            ? '说明如何核对 Ads 对象；拒绝时写明具体原因'
            : '说明为何该 Ads 对象与当前建议唯一对应'}
          rows={3}
          value={form.rationale}
        />
      </label>
      <label>
        <span>可写对象类型</span>
        <select
          onChange={(event) => setForm((current) => ({
            ...current,
            entityType: event.target.value as DecisionsReviewFormState['entityType'],
          }))}
          value={form.entityType}
        >
          <option value="">请选择唯一类型</option>
          <option value="keyword">关键词</option>
          <option value="auto_targeting">自动投放</option>
          <option value="product_targeting">商品投放</option>
        </select>
      </label>
      <label>
        <span>Ads 对象 ID</span>
        <input
          autoComplete="off"
          onChange={(event) => setForm((current) => ({
            ...current,
            entityId: event.target.value,
          }))}
          placeholder="填写 Ads UI / API 中的真实对象 ID"
          value={form.entityId}
        />
      </label>
      <label>
        <span>来源文件</span>
        <select
          onChange={(event) => setForm((current) => ({
            ...current,
            sourceFile: event.target.value,
          }))}
          value={form.sourceFile}
        >
          <option value="">请选择当前批次报表</option>
          {sourceFiles.map((sourceRef) => (
            <option key={sourceRef} value={sourceRef}>{sourceRef}</option>
          ))}
        </select>
      </label>
      <label>
        <span>唯一来源行</span>
        <input
          inputMode="numeric"
          min="1"
          onChange={(event) => setForm((current) => ({
            ...current,
            sourceRow: event.target.value,
          }))}
          placeholder="例如 611"
          step="1"
          type="number"
          value={form.sourceRow}
        />
      </label>
      <label>
        <span>身份核验来源</span>
        <select
          onChange={(event) => setForm((current) => ({
            ...current,
            identitySource: event.target.value as DecisionsReviewFormState['identitySource'],
          }))}
          value={form.identitySource}
        >
          <option value="ads_ui">Ads UI</option>
          <option value="ads_api">Ads API</option>
        </select>
      </label>
      <label className="decisions-review-form__wide">
        <span>身份核验证据路径</span>
        <input
          autoComplete="off"
          onChange={(event) => setForm((current) => ({
            ...current,
            identityProofPath: event.target.value,
          }))}
          placeholder="填写本地截图、JSON 或导出证据的完整路径"
          value={form.identityProofPath}
        />
      </label>
      <label className="decisions-review-form__wide">
        <span>身份核验说明</span>
        <textarea
          onChange={(event) => setForm((current) => ({
            ...current,
            verificationNote: event.target.value,
          }))}
          placeholder="说明活动、广告组、对象名称与 ID 的核对过程"
          rows={3}
          value={form.verificationNote}
        />
      </label>
    </fieldset>
  );
}
