import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ago, type PlanTemplate } from '../api';
import { Icon } from '../krds';

/**
 * 2차년도 메인 화면(Figma "문서생성도구 / 홈 화면", 2026-08-21 추출)의 히어로 + 템플릿 카드 줄.
 * 카드 260×224 · 모서리 12 · 상단 띠 64 + 유형 뱃지(그라데이션) + 48px 아이콘. 배경·아이콘은 /public/hero (피그마 원본에서 변환).
 */
type HazardStyle = { icon: string; band: string; badge: string };
const NATURAL: Omit<HazardStyle, 'icon'> = { band: '#fff6f1', badge: 'linear-gradient(90deg,#ff7e36,#fc6b19)' };
const DISEASE: Omit<HazardStyle, 'icon'> = { band: '#f2f6ff', badge: 'linear-gradient(90deg,#4784f3,#246beb)' };
const FACILITY: Omit<HazardStyle, 'icon'> = { band: '#f1f9f3', badge: 'linear-gradient(90deg,#0ca82e,#008a1e)' };
export const HAZARD_STYLE: Record<string, HazardStyle> = {
  '폭염': { icon: 'heat', ...NATURAL }, '태풍/호우': { icon: 'typhoon', ...NATURAL }, '지진': { icon: 'quake', ...NATURAL }, '황사': { icon: 'dust', ...NATURAL }, '산불': { icon: 'wildfire', ...NATURAL },
  '감염병': { icon: 'infection', ...DISEASE }, '가축질병': { icon: 'livestock', ...DISEASE },
  '다중밀집건축물붕괴대형사고': { icon: 'collapse', ...FACILITY }, '정부주요시설': { icon: 'gov', ...FACILITY }, '학교시설': { icon: 'school', ...FACILITY },
};
const FALLBACK: HazardStyle = { icon: 'gov', band: '#f4f5f6', badge: 'linear-gradient(90deg,#6d7580,#464c53)' };

export function HazardIcon({ hazard, size = 48 }: { hazard?: string; size?: number }) {
  const s = HAZARD_STYLE[hazard ?? ''] ?? FALLBACK;
  return <img src={`/hero/${s.icon}.svg`} width={size} height={size} alt="" style={{ borderRadius: 8, display: 'block' }} />;
}

export function HeroCards({ userName, tpls, onNew, onPick }: { userName?: string; tpls: PlanTemplate[]; onNew: () => void; onPick: (t: PlanTemplate) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const step = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * 288 * 3, behavior: 'smooth' });
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap hero-inner">
        <h1 id="hero-title" className="hero-title">{userName ? `${userName}님,` : '안녕하세요,'}<br />필요한 문서를 지금 바로 생성해보세요!</h1>
        <div className="hero-tools">
          <button type="button" className="hero-arrow" onClick={() => step(-1)} aria-label="이전 템플릿"><Icon name="back" size={18} /></button>
          <button type="button" className="hero-arrow" onClick={() => step(1)} aria-label="다음 템플릿"><Icon name="angle" size={18} /></button>
          <Link to="/plan/basis-templates" className="hero-more">더보기</Link>
        </div>
        <div className="hero-rail" ref={rail}>
          <button type="button" className="hcard hcard-new" onClick={onNew}>
            <span className="hcard-new-ico"><Icon name="plus" size={28} /></span>
            <span>새 문서 생성</span>
          </button>
          {tpls.map((t) => {
            const s = HAZARD_STYLE[t.context.hazardType] ?? FALLBACK;
            return (
              <button type="button" key={t.id} className="hcard" onClick={() => onPick(t)} title={`${t.name} — 이 템플릿으로 새 문서`}>
                <span className="hcard-band" style={{ background: s.band }}>
                  <span className="hcard-badge" style={{ background: s.badge }}>{t.context.hazardType || '유형 없음'}</span>
                </span>
                <span className="hcard-ico"><HazardIcon hazard={t.context.hazardType} /></span>
                <strong className="hcard-title">{t.name}</strong>
                <span className="hcard-row"><span>재난관리 단계</span><span className="hcard-phase"><i />{t.context.managementPhase || '-'}</span></span>
                <span className="hcard-foot"><span>{t.createdBy}</span><span>{ago(t.updatedAt)}</span></span>
              </button>
            );
          })}
          {!tpls.length && <p className="hero-empty">저장된 기준정보 템플릿이 없습니다. 새 문서를 만들고 기준정보 화면에서 "템플릿 등록하기"로 저장하면 여기에 카드로 나타납니다.</p>}
        </div>
      </div>
    </section>
  );
}
