import test from "node:test";
import assert from "node:assert/strict";

import { STORE_FIXTURES } from "../src/mockData.js";

import {
  adObjectTableRow,
  businessGroupLabel,
  businessGroupPath,
  businessGroupTransitions,
  localizeMatchType,
  recommendationTableRow,
} from "../src/prototype-presenters.js";

test("广告匹配类型和投放类型全部转换为中文业务名称", () => {
  assert.equal(localizeMatchType("exact"), "精准匹配");
  assert.equal(localizeMatchType("Exact"), "精准匹配");
  assert.equal(localizeMatchType("phrase"), "词组匹配");
  assert.equal(localizeMatchType("broad"), "广泛匹配");
  assert.equal(localizeMatchType("close-match"), "紧密匹配");
  assert.equal(localizeMatchType("substitutes"), "替代商品");
});

test("广告对象表明确拆分活动、广告组、对象层级和具体对象", () => {
  const row = adObjectTableRow({
    id: "diag-1",
    objectKey: "store|asin|group|keyword",
    objectType: "keyword",
    objectName: "keypad door lock",
    campaignName: "D6-精准-核心长尾",
    adGroupName: "Exact-Core",
    matchType: "exact",
    spend: 127.4,
    acos: 0.637,
    severity: "high",
  });
  assert.equal(row.campaign, "D6-精准-核心长尾");
  assert.equal(row.adGroup, "Exact-Core");
  assert.equal(row.level, "关键词");
  assert.equal(row.object, "keypad door lock");
  assert.equal(row.targetingType, "精准匹配");
  assert.equal(row.health, "高风险");
});

test("业务表按广告活动再按广告组形成两级分组，活动级广告位不伪造广告组", () => {
  assert.deepEqual(businessGroupPath({
    campaign: "D6-精准-核心长尾",
    adGroup: "Exact-Core",
  }), [
    {
      key: "campaign:D6-精准-核心长尾",
      level: "campaign",
      label: "广告活动：D6-精准-核心长尾",
    },
    {
      key: "ad-group:D6-精准-核心长尾:Exact-Core",
      level: "ad-group",
      label: "广告组：Exact-Core",
    },
  ]);

  assert.deepEqual(businessGroupPath({
    campaign: "D6-精准-核心长尾",
    adGroup: "活动级",
    level: "广告位",
  }), [
    {
      key: "campaign:D6-精准-核心长尾",
      level: "campaign",
      label: "广告活动：D6-精准-核心长尾",
    },
  ]);
});

test("活动级广告位忽略来源里的广告组名并保持单层活动路径", () => {
  const row = adObjectTableRow({
    objectKey: "store|asin|campaign|top-of-search",
    objectType: "placement",
    objectName: "搜索结果顶部",
    campaignName: "活动 A",
    adGroupName: "不应显示的派生广告组",
    spend: 42.6,
    acos: 0.24,
  });

  assert.equal(row.adGroup, "活动级");
  assert.deepEqual(businessGroupPath(row), [
    {
      key: "campaign:活动 A",
      level: "campaign",
      label: "广告活动：活动 A",
    },
  ]);
  assert.equal(`${row.campaign} > ${row.adGroup} > ${row.level}：${row.object}`.includes("不应显示的派生广告组"), false);
});

test("完整八类店铺夹具包含可在广告对象表展示的活动级广告位", () => {
  const placement = STORE_FIXTURES.SHC001.diagnostics.find((item) => item.objectType === "placement");

  assert.ok(placement, "8/8 完整店铺应提供一条真实层级的广告位对象");
  const row = adObjectTableRow(placement);
  assert.equal(row.campaign, "D6-精准-核心长尾");
  assert.equal(row.adGroup, "活动级");
  assert.equal(row.level, "广告位");
  assert.equal(row.object, "搜索结果顶部");
});

test("业务表只在活动或广告组边界插入对应层级表头", () => {
  const transitions = businessGroupTransitions([
    { id: "kw-1", campaign: "活动 A", adGroup: "组 1", level: "关键词" },
    { id: "kw-2", campaign: "活动 A", adGroup: "组 1", level: "关键词" },
    { id: "kw-3", campaign: "活动 A", adGroup: "组 2", level: "关键词" },
    { id: "placement-1", campaign: "活动 B", adGroup: "活动级", level: "广告位" },
  ]);

  assert.deepEqual(transitions.map((entry) => entry.groups.map((group) => group.key)), [
    ["campaign:活动 A", "ad-group:活动 A:组 1"],
    [],
    ["ad-group:活动 A:组 2"],
    ["campaign:活动 B"],
  ]);
});

test("商品投放和自动投放不再显示成其他投放方式", () => {
  const productTarget = adObjectTableRow({
    objectKey: "store|asin|product-target",
    objectType: "product_targeting",
    objectName: "ASIN B0C8V4M1RX",
    campaignName: "NK01-Product",
    adGroupName: "Product-Core",
  });
  const autoTarget = adObjectTableRow({
    objectKey: "store|asin|auto-target",
    objectType: "auto_targeting",
    objectName: "close-match",
    campaignName: "NK01-Auto",
    adGroupName: "Auto",
  });
  const autoRecommendation = recommendationTableRow({
    entityType: "auto_targeting",
    actionType: "bid_change",
    objectName: "substitutes",
    campaignName: "NK01-Auto",
    adGroupName: "Auto",
    currentValue: 0.91,
    recommendedValue: 0.84,
    unit: "currency",
  });

  assert.equal(productTarget.targetingType, "商品投放");
  assert.equal(autoTarget.targetingType, "紧密匹配");
  assert.equal(autoRecommendation.targetingType, "替代商品");
  assert.equal(autoRecommendation.action, "调整自动投放竞价");
  assert.equal(businessGroupLabel(productTarget), "广告活动：NK01-Product · 广告组：Product-Core");
});

test("分析建议表明确展示改动对象、动作与前后值", () => {
  const row = recommendationTableRow({
    id: "rec-1",
    entityType: "keyword",
    actionType: "keyword_bid_adjustment",
    campaignName: "D6-精准-核心长尾",
    adGroupName: "Exact-Core",
    objectName: "keypad door lock",
    matchType: "exact",
    currentValue: 1.3,
    recommendedValue: 1.17,
    currency: "USD",
    status: "approved",
    reason: "花费上升且转化率下降",
  });
  assert.equal(row.level, "关键词");
  assert.equal(row.targetingType, "精准匹配");
  assert.equal(row.action, "调整关键词竞价");
  assert.equal(row.change, "$1.30 → $1.17");
  assert.equal(row.statusLabel, "许可已签发");
});

test("广告位调整按百分比展示且对象名称不重复英文匹配类型", () => {
  const placement = recommendationTableRow({
    id: "rec-placement",
    entityType: "placement",
    actionType: "placement_adjustment",
    campaignName: "D6-精准-核心长尾",
    objectName: "搜索结果顶部",
    currentValue: 20,
    recommendedValue: 10,
    unit: "percent",
  });
  const productTarget = recommendationTableRow({
    id: "rec-product",
    entityType: "product_targeting",
    actionType: "bid_change",
    campaignName: "NK01-Product",
    adGroupName: "Product-Core",
    objectName: "ASIN B0C8V4M1RX · product targeting",
    currentValue: 0.92,
    recommendedValue: 0.84,
    unit: "currency",
  });

  assert.equal(placement.level, "广告位");
  assert.equal(placement.action, "调整广告位系数");
  assert.equal(placement.change, "20% → 10%");
  assert.equal(productTarget.object, "ASIN B0C8V4M1RX");
  assert.equal(productTarget.targetingType, "商品投放");
  assert.equal(productTarget.action, "调整商品投放竞价");
});
