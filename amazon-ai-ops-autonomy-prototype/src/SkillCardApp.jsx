/**
 * Amazon AI Ops - Skill Card Prototype
 * 技能卡片式交互原型 - 店铺级数据隔离 + 模块化技能
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  // Navigation
  Compass,
  Cube,
  Database,
  ChartLineUp,
  ListChecks,
  Target,
  Gear,
  
  // Actions
  Play,
  CheckCircle,
  WarningCircle,
  X,
  MagnifyingGlass,
  Bell,
  Robot,
  UserCircle,
  DotsThree,
  Plus,
  Eye,
  ArrowRight,
  
  // Status
  CircleNotch,
  Clock,
  Lightning,
  
  // Skill Icons
  ChartBar,
  Download,
  FileArrowUp,
  Brain,
  Lightbulb,
  ShieldCheck,
  Timer,
  Package,
  ListBullets,
  CalendarBlank,
  Truck,
  
  // Misc
  Shield,
  Info,
} from "@phosphor-icons/react";
import "./skills-prototype.css";

// ============================================
// Mock Data
// ============================================

const STORES = [
  { id: "FT-US", name: "美国站", marketplace: "US", currency: "$" },
  { id: "FT-DE", name: "德国站", marketplace: "DE", currency: "€" },
  { id: "FT-JP", name: "日本站", marketplace: "JP", currency: "¥" },
];

const INITIAL_STATE = {
  // Store Context
  currentStore: "FT-US",
  mode: "review", // "review" | "semi" | "auto"
  
  // Skills State
  skills: {
    // 数据采集技能组
    reportCollection: {
      id: "reportCollection",
      title: "报表采集",
      subtitle: "领星下载中心",
      status: "ready", // ready | running | success | warning | danger
      lastRun: "2小时前",
      metrics: {
        reports: "8/8",
        rows: "2,847",
        status: "完整"
      }
    },
    
    dataImport: {
      id: "dataImport",
      title: "数据导入",
      subtitle: "本地库写入",
      status: "success",
      lastRun: "1小时前",
      metrics: {
        rows: "2,847",
        validation: "通过"
      }
    },
    
    // 分析技能组
    adDiagnosis: {
      id: "adDiagnosis",
      title: "广告诊断",
      subtitle: "AI 阶段分析",
      status: "success",
      lastRun: "1小时前",
      metrics: {
        objects: "12",
        issues: "3"
      },
      results: [
        "活动 A ACOS 45% ↑",
        "活动 B 花费过高 ↑",
        "关键词 C 有否词机会"
      ]
    },
    
    adQuant: {
      id: "adQuant",
      title: "广告量化",
      subtitle: "产品级指标",
      status: "ready",
      lastRun: "昨日",
      metrics: {
        acos: "32%",
        targetAcos: "30%"
      }
    },
    
    // 优化技能组
    recommendations: {
      id: "recommendations",
      title: "优化建议",
      subtitle: "AI 推荐列表",
      status: "warning", // has pending approvals
      pendingCount: 3,
      lastRun: "1小时前",
      metrics: {
        total: 12,
        pending: 3,
        approved: 8,
        rejected: 1
      }
    },
    
    keywordOpportunity: {
      id: "keywordOpportunity",
      title: "关键词机会",
      subtitle: "否词 + 扩词",
      status: "ready",
      lastRun: "3小时前",
      metrics: {
        opportunities: 24
      }
    },
    
    listingOptimization: {
      id: "listingOptimization",
      title: "Listing 优化",
      subtitle: "关键词覆盖",
      status: "ready",
      lastRun: "昨日",
      metrics: {
        coverage: "78%",
        suggestions: 5
      }
    },
    
    // 执行技能组
    pendingApprovals: {
      id: "pendingApprovals",
      title: "待审批",
      subtitle: "人工确认",
      status: "danger",
      pendingCount: 3,
      lastRun: "待处理",
      metrics: {
        items: [
          { type: "精准", campaign: "B0GVRVD4PK", from: "$2.32", to: "$2.09", reason: "ACOS 超标 32% → 28%" },
          { type: "自动", campaign: "核心词 A", from: "$1.80", to: "$1.62", reason: "低转化降权" },
          { type: "否词", campaign: "否定词清理", count: 8, reason: "无效搜索词" }
        ]
      }
    },
    
    executionQueue: {
      id: "executionQueue",
      title: "执行队列",
      subtitle: "已授权待执行",
      status: "success",
      lastRun: "已完成",
      metrics: {
        total: 5,
        done: 5,
        pending: 0
      }
    },
    
    readback: {
      id: "readback",
      title: "执行回读",
      subtitle: "证据链验证",
      status: "success",
      lastRun: "30分钟前",
      metrics: {
        verified: 5,
        pending: 0,
        failed: 0
      }
    },
    
    // 任务技能组
    missionCenter: {
      id: "missionCenter",
      title: "任务中心",
      subtitle: "今日 / 全部",
      status: "ready",
      lastRun: "进行中",
      metrics: {
        today: 3,
        total: 12
      }
    },
    
    causalMemory: {
      id: "causalMemory",
      title: "因果记忆",
      subtitle: "运营账本",
      status: "ready",
      lastRun: "持续记录",
      metrics: {
        events: 156
      }
    },
    
    // 系统技能组
    productConfig: {
      id: "productConfig",
      title: "产品配置",
      subtitle: "ACOS 目标",
      status: "success",
      lastRun: "今日",
      metrics: {
        products: 5
      }
    },
    
    scheduler: {
      id: "scheduler",
      title: "定时任务",
      subtitle: "自动化编排",
      status: "ready",
      lastRun: "运行中",
      metrics: {
        active: 2,
        total: 4
      }
    },
    
    delivery: {
      id: "delivery",
      title: "交付验收",
      subtitle: "交付门槛",
      status: "warning",
      lastRun: "待验收",
      metrics: {
        gates: "7/8",
        blocked: "Task 8B"
      }
    }
  }
};

// ============================================
// Skill Card Component
// ============================================

function SkillCard({ 
  skill, 
  icon: Icon, 
  iconColor = "primary",
  onAction,
  onView,
  isApproval = false,
  isPending = false
}) {
  const [isRunning, setIsRunning] = useState(false);
  const [showResult, setShowResult] = useState(false);
  
  const statusClass = skill.status;
  
  const handleRun = () => {
    setIsRunning(true);
    setTimeout(() => {
      setIsRunning(false);
      if (skill.results) {
        setShowResult(true);
      }
      onAction?.(skill.id);
    }, 1500);
  };
  
  const cardClass = `skill-card state-${statusClass}${isApproval ? " approval-card" : ""}`;
  
  return (
    <div className={cardClass}>
      <div className="card-header">
        <div className={`card-icon ${iconColor}`}>
          <Icon weight="duotone" />
        </div>
        <div className="card-title-wrap">
          <div className="card-title">{skill.title}</div>
          <div className="card-subtitle">{skill.subtitle}</div>
        </div>
        <button className="card-menu-btn" type="button" aria-label="更多操作">
          <DotsThree size={18} weight="bold" />
        </button>
      </div>
      
      <div className="card-status">
        <span className={`status-chip ${isRunning ? "running" : statusClass}`}>
          {isRunning ? (
            <>
              <CircleNotch className="spinner" size={12} />
              运行中...
            </>
          ) : (
            <>
              {skill.status === "ready" && "就绪"}
              {skill.status === "success" && "✓ 完成"}
              {skill.status === "warning" && "⚠ 待处理"}
              {skill.status === "danger" && "✗ 需审批"}
            </>
          )}
        </span>
        {skill.pendingCount > 0 && (
          <span className="status-chip warning" style={{ marginLeft: 8 }}>
            {skill.pendingCount} 条
          </span>
        )}
      </div>
      
      <div className="card-divider" />
      
      <div className="card-body">
        <div className="card-info">
          {Object.entries(skill.metrics).slice(0, 3).map(([key, value]) => {
            if (Array.isArray(value)) return null;
            return (
              <div className="info-row" key={key}>
                <span className="info-label">{key}</span>
                <span className={`info-value ${typeof value === 'string' && value.includes('/') ? 'highlight' : ''}`}>
                  {value}
                </span>
              </div>
            );
          })}
        </div>
        
        {showResult && skill.results && (
          <div className="card-result">
            <div className="card-result-title">发现问题</div>
            <ul className="card-result-list">
              {skill.results.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        
        {isApproval && skill.metrics.items && (
          <div className="card-result" style={{ marginTop: 12 }}>
            {skill.metrics.items.slice(0, 1).map((item, i) => (
              <div key={i}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.campaign}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  {item.from} → {item.to} · {item.reason}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="card-actions">
        {isApproval ? (
          <>
            <button className="card-btn success" onClick={() => onAction?.(skill.id, 'approve')} disabled={isRunning}>
              ✓ 批准
            </button>
            <button className="card-btn danger" onClick={() => onAction?.(skill.id, 'reject')} disabled={isRunning}>
              ✗ 拒绝
            </button>
          </>
        ) : (
          <>
            <button 
              className="card-btn primary" 
              onClick={handleRun} 
              disabled={isRunning || skill.status === 'running'}
            >
              {isRunning ? (
                <>
                  <CircleNotch className="spinner" size={14} />
                  运行中...
                </>
              ) : (
                <>
                  <Play size={14} weight="fill" />
                  {skill.status === 'ready' ? '运行' : '刷新'}
                </>
              )}
            </button>
            <button className="card-btn" onClick={() => onView?.(skill.id)}>
              <Eye size={14} />
              详情
            </button>
          </>
        )}
      </div>
      
      <div className="card-footer">
        <span>最近：{skill.lastRun}</span>
        <span className="font-mono" style={{ fontSize: 11 }}>FT-US</span>
      </div>
    </div>
  );
}

// ============================================
// Pending Approval Card (Special)
// ============================================

function PendingApprovalCard({ skill, onApprove, onReject }) {
  const [selectedItems, setSelectedItems] = useState([]);
  
  const toggleItem = (index) => {
    setSelectedItems(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };
  
  const approveAll = () => {
    onApprove?.(selectedItems);
    setSelectedItems([]);
  };
  
  return (
    <div className="skill-card state-danger">
      <div className="card-header">
        <div className="card-icon danger">
          <ListChecks weight="duotone" />
        </div>
        <div className="card-title-wrap">
          <div className="card-title">{skill.title}</div>
          <div className="card-subtitle">{skill.subtitle}</div>
        </div>
        <span className="status-chip danger">{skill.pendingCount} 条</span>
      </div>
      
      <div className="card-divider" />
      
      <div className="card-body" style={{ maxHeight: 300, overflowY: 'auto' }}>
        {skill.metrics.items?.map((item, index) => (
          <div 
            key={index}
            style={{
              padding: '12px',
              marginBottom: 8,
              background: selectedItems.includes(index) ? 'var(--color-danger-light)' : 'var(--color-bg)',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${selectedItems.includes(index) ? 'var(--color-danger)' : 'var(--color-border)'}`,
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
            onClick={() => toggleItem(index)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{item.campaign}</span>
              <span className="status-chip" style={{ background: 'var(--color-bg)', fontSize: 11 }}>
                {item.type}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
              {item.from} → <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{item.to}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.reason}</div>
          </div>
        ))}
      </div>
      
      <div className="card-actions">
        <button 
          className="card-btn success" 
          onClick={approveAll}
          disabled={selectedItems.length === 0}
        >
          <CheckCircle size={14} weight="fill" />
          批量批准 ({selectedItems.length})
        </button>
        <button className="card-btn" disabled={selectedItems.length === 0}>
          <Eye size={14} />
          详情
        </button>
      </div>
      
      <div className="card-footer">
        <span>需要人工审批</span>
        <span style={{ color: 'var(--color-danger)' }}>待处理</span>
      </div>
    </div>
  );
}

// ============================================
// Toast Component
// ============================================

function Toast({ message, type = 'default', onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  
  return (
    <div className={`toast ${type}`}>
      {type === 'success' && <CheckCircle size={18} weight="fill" />}
      {type === 'warning' && <WarningCircle size={18} weight="fill" />}
      {type === 'danger' && <X size={18} weight="bold" />}
      <span>{message}</span>
    </div>
  );
}

// ============================================
// Main App Component
// ============================================

export function SkillCardApp() {
  const [state, setState] = useState(INITIAL_STATE);
  const [toast, setToast] = useState(null);
  const [activeSection, setActiveSection] = useState('data');
  
  const currentStore = STORES.find(s => s.id === state.currentStore);
  
  const showToast = useCallback((message, type = 'default') => {
    setToast({ message, type, id: Date.now() });
  }, []);
  
  const handleSkillAction = useCallback((skillId, action = 'run') => {
    if (action === 'approve') {
      showToast('建议已批准，进入执行队列', 'success');
    } else if (action === 'reject') {
      showToast('建议已拒绝', 'warning');
    } else {
      showToast('技能执行完成', 'success');
    }
    
    setState(prev => ({
      ...prev,
      skills: {
        ...prev.skills,
        [skillId]: {
          ...prev.skills[skillId],
          status: 'success',
          lastRun: '刚刚'
        }
      }
    }));
  }, [showToast]);
  
  const handleBatchApprove = useCallback((indices) => {
    showToast(`已批准 ${indices.length} 条建议`, 'success');
    setState(prev => ({
      ...prev,
      skills: {
        ...prev.skills,
        pendingApprovals: {
          ...prev.skills.pendingApprovals,
          pendingCount: prev.skills.pendingApprovals.pendingCount - indices.length
        }
      }
    }));
  }, [showToast]);
  
  const handleStoreSwitch = (storeId) => {
    setState(prev => ({ ...prev, currentStore: storeId }));
    showToast(`已切换到 ${storeId}`, 'success');
  };
  
  const handleModeChange = (mode) => {
    setState(prev => ({ ...prev, mode }));
    const modeText = mode === 'review' ? '人工审批' : mode === 'semi' ? '半自动' : 'AI 全自动';
    showToast(`执行模式：${modeText}`, 'success');
  };
  
  // Group skills by section
  const sections = {
    data: [
      { id: 'reportCollection', icon: Download, color: 'primary' },
      { id: 'dataImport', icon: FileArrowUp, color: 'success' },
    ],
    analysis: [
      { id: 'adDiagnosis', icon: Brain, color: 'primary' },
      { id: 'adQuant', icon: ChartBar, color: 'success' },
    ],
    optimization: [
      { id: 'recommendations', icon: Lightbulb, color: 'warning' },
      { id: 'keywordOpportunity', icon: Target, color: 'primary' },
      { id: 'listingOptimization', icon: Package, color: 'success' },
    ],
    execution: [
      { id: 'pendingApprovals', icon: ListChecks, color: 'danger', isApproval: true },
      { id: 'executionQueue', icon: Lightning, color: 'success' },
      { id: 'readback', icon: ShieldCheck, color: 'success' },
    ],
    mission: [
      { id: 'missionCenter', icon: CalendarBlank, color: 'primary' },
      { id: 'causalMemory', icon: Clock, color: 'primary' },
    ],
    system: [
      { id: 'productConfig', icon: Cube, color: 'success' },
      { id: 'scheduler', icon: Timer, color: 'primary' },
      { id: 'delivery', icon: Truck, color: 'warning' },
    ],
  };
  
  const sectionLabels = {
    data: '数据采集',
    analysis: '分析诊断',
    optimization: '优化建议',
    execution: '审批执行',
    mission: '任务管理',
    system: '系统配置',
  };
  
  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Compass size={20} weight="fill" />
          </div>
          <span>运营巡航台</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            className="store-selector"
            onClick={() => {
              const currentIndex = STORES.findIndex(s => s.id === state.currentStore);
              const nextStore = STORES[(currentIndex + 1) % STORES.length];
              handleStoreSwitch(nextStore.id);
            }}
          >
            <span className="store-badge">{currentStore.id}</span>
            <span>{currentStore.name}</span>
          </button>
        </div>
        
        <div className="topbar-center">
          <div className="mode-toggle">
            <button 
              className={`mode-btn ${state.mode === 'review' ? 'active' : ''}`}
              onClick={() => handleModeChange('review')}
            >
              <UserCircle size={16} />
              人工
            </button>
            <button 
              className={`mode-btn ${state.mode === 'semi' ? 'active' : ''}`}
              onClick={() => handleModeChange('semi')}
            >
              <Lightning size={16} />
              半自动
            </button>
            <button 
              className={`mode-btn ${state.mode === 'auto' ? 'active' : ''}`}
              onClick={() => handleModeChange('auto')}
            >
              <Robot size={16} />
              全自动
            </button>
          </div>
        </div>
        
        <div className="topbar-right">
          <button className="icon-btn" aria-label="搜索">
            <MagnifyingGlass size={20} />
          </button>
          <button className="icon-btn" aria-label="通知">
            <Bell size={20} />
          </button>
          <div className="avatar">张</div>
        </div>
      </header>
      
      {/* Sidebar */}
      <aside className="sidebar">
        <nav className="nav-section">
          <div className="nav-label">功能模块</div>
          <ul className="nav-list">
            {Object.entries(sectionLabels).map(([key, label]) => {
              const skills = sections[key];
              const hasWarning = skills.some(s => {
                const skill = state.skills[s.id];
                return skill?.status === 'warning' || skill?.status === 'danger' || skill?.pendingCount > 0;
              });
              const badge = key === 'execution' && state.skills.pendingApprovals?.pendingCount > 0 
                ? state.skills.pendingApprovals.pendingCount 
                : null;
              
              return (
                <li key={key}>
                  <button 
                    className={`nav-item ${activeSection === key ? 'active' : ''}`}
                    onClick={() => setActiveSection(key)}
                  >
                    {key === 'data' && <Database size={18} />}
                    {key === 'analysis' && <ChartLineUp size={18} />}
                    {key === 'optimization' && <Lightbulb size={18} />}
                    {key === 'execution' && <Lightning size={18} />}
                    {key === 'mission' && <CalendarBlank size={18} />}
                    {key === 'system' && <Gear size={18} />}
                    <span>{label}</span>
                    {badge && <span className="nav-badge">{badge}</span>}
                    {!badge && hasWarning && <span className="nav-badge warning">!</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        
        <div className="nav-section" style={{ marginTop: 'auto' }}>
          <div style={{ padding: '12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              <Shield size={14} style={{ marginRight: 6 }} />
              {currentStore.id} · 独立舱
            </div>
            <div style={{ color: 'var(--color-text-secondary)' }}>
              {currentStore.marketplace} · 本地库隔离
            </div>
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="main-content">
        <div className="prototype-notice">
          <Info size={16} />
          <span>
            <b>交互原型</b> · 使用模拟数据，不连接领星或 Amazon Ads，不产生真实广告写入。
          </span>
        </div>
        
        <div className="page-header">
          <h1 className="page-title">{sectionLabels[activeSection]}</h1>
          <p className="page-subtitle">
            {currentStore.id} · {currentStore.name} · 
            {state.mode === 'review' ? '人工审批模式' : state.mode === 'semi' ? '半自动模式' : 'AI 全自动模式'}
          </p>
        </div>
        
        <div className="cards-container">
          <div className="skill-grid">
            {sections[activeSection].map(skillConfig => {
              const skill = state.skills[skillConfig.id];
              if (!skill) return null;
              
              if (skillConfig.id === 'pendingApprovals') {
                return (
                  <PendingApprovalCard
                    key={skillConfig.id}
                    skill={skill}
                    onApprove={handleBatchApprove}
                  />
                );
              }
              
              return (
                <SkillCard
                  key={skillConfig.id}
                  skill={skill}
                  icon={skillConfig.icon}
                  iconColor={skillConfig.color}
                  onAction={(id) => handleSkillAction(id)}
                  isApproval={skillConfig.isApproval}
                />
              );
            })}
          </div>
        </div>
      </main>
      
      {/* Toast Container */}
      <div className="toast-container">
        {toast && (
          <Toast 
            key={toast.id}
            message={toast.message} 
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </div>
  );
}

export default SkillCardApp;
