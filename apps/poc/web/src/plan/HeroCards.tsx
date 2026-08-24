import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ago, type PlanTemplate } from '../api';
import { Icon } from '../krds';

/**
 * 2차년도 메인 화면(Figma "문서생성도구 / 홈 화면", 2026-08-21 추출)의 히어로 + 카드 줄.
 * 카드 260×224 · 모서리 12 · 상단 띠 64 + 유형 뱃지(그라데이션) + 48px 아이콘. 배경·아이콘은 /public/hero (피그마 원본에서 변환).
 * HeroBand(띠·제목·화살표·더보기·레일)는 계획서 메인과 상황일지 메인이 같이 쓴다 — 카드 내용만 다르다.
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
export const hazardStyle = (hazard?: string) => HAZARD_STYLE[hazard ?? ''] ?? FALLBACK;

export function HazardIcon({ hazard, size = 48 }: { hazard?: string; size?: number }) {
  const s = hazardStyle(hazard);
  return <img src={`/hero/${s.icon}.svg`} width={size} height={size} alt="" style={{ borderRadius: 8, display: 'block' }} />;
}

/** 히어로 띠: 제목 + ‹ › + 더보기 + 가로 카드 레일. children에 카드를 넣는다 */
export function HeroBand({ title, moreTo, moreLabel = '더보기', children }: { title: ReactNode; moreTo?: string; moreLabel?: string; children: ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  const step = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * 288 * 3, behavior: 'smooth' });
  // 드래그 슬라이딩(사용자 요청 2026-08-24): 화살표 말고도 마우스로 잡아 좌우로 끈다. 5px 넘게 움직였으면 끝난 뒤의 카드 클릭은 무시
  const drag = useRef<{ x: number; sl: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => { if (e.button !== 0) return; const el = rail.current; if (!el) return; drag.current = { x: e.clientX, sl: el.scrollLeft, moved: false }; };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; const el = rail.current; if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) { d.moved = true; el.classList.add('dragging'); try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    if (d.moved) el.scrollLeft = d.sl - dx;
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; const el = rail.current;
    if (d?.moved && el) { suppressClick.current = true; el.classList.remove('dragging'); try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }
  };
  const onClickCapture = (e: React.MouseEvent) => { if (suppressClick.current) { suppressClick.current = false; e.preventDefault(); e.stopPropagation(); } };
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap hero-inner">
        <div className="hero-head">
          <h1 id="hero-title" className="hero-title">{title}</h1>
          <div className="hero-tools">
            <button type="button" className="hero-arrow" onClick={() => step(-1)} aria-label="이전 카드"><Icon name="back" size={18} /></button>
            <button type="button" className="hero-arrow" onClick={() => step(1)} aria-label="다음 카드"><Icon name="angle" size={18} /></button>
            {moreTo && <Link to={moreTo} className="hero-more">{moreLabel}</Link>}
          </div>
        </div>
        <div className="hero-rail" ref={rail} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onPointerLeave={onPointerEnd} onClickCapture={onClickCapture}>{children}</div>
      </div>
    </section>
  );
}

/** 히어로 카드 한 장 — 상단 띠(유형 뱃지) + 아이콘 + 제목 + 정보 줄 + 하단 줄 */
export function HeroCard({ hazard, badge, title, rowLabel, rowValue, rowDot = '#37b44a', foot, onClick, titleAttr }: { hazard?: string; badge?: ReactNode; title: ReactNode; rowLabel: ReactNode; rowValue: ReactNode; rowDot?: string; foot: [ReactNode, ReactNode]; onClick: () => void; titleAttr?: string }) {
  const s = hazardStyle(hazard);
  return (
    <button type="button" className="hcard" onClick={onClick} title={titleAttr}>
      <span className="hcard-band" style={{ background: s.band }}>
        <span className="hcard-badge" style={{ background: s.badge }}>{badge ?? hazard ?? '유형 없음'}</span>
      </span>
      <span className="hcard-ico"><HazardIcon hazard={hazard} /></span>
      <strong className="hcard-title">{title}</strong>
      <span className="hcard-row"><span>{rowLabel}</span><span className="hcard-phase"><i style={{ background: rowDot }} />{rowValue}</span></span>
      <span className="hcard-foot"><span>{foot[0]}</span><span>{foot[1]}</span></span>
    </button>
  );
}

/** "새로 만들기" 카드 */
export function HeroNewCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="hcard hcard-new" onClick={onClick}>
      <span className="hcard-new-ico"><Icon name="plus" size={28} /></span>
      <span>{label}</span>
    </button>
  );
}

/** 계획서 메인: 새 문서 생성 + 기준정보 템플릿 카드 */
export function HeroCards({ tpls, onNew, onPick }: { tpls: PlanTemplate[]; onNew: () => void; onPick: (t: PlanTemplate) => void }) {
  return (
    <HeroBand title="필요한 문서를 지금 바로 생성해보세요!" moreTo="/plan/basis-templates">
      <HeroNewCard label="새 문서 생성" onClick={onNew} />
      {tpls.map((t) => (
        <HeroCard key={t.id} hazard={t.context.hazardType} title={t.name} rowLabel="재난관리 단계" rowValue={t.context.managementPhase || '-'} foot={[t.createdBy, ago(t.updatedAt)]} onClick={() => onPick(t)} titleAttr={`${t.name} — 이 템플릿으로 새 문서`} />
      ))}
      {!tpls.length && <p className="hero-empty">저장된 기준정보 템플릿이 없습니다. 새 문서를 만들고 기준정보 화면에서 "템플릿 등록하기"로 저장하면 여기에 카드로 나타납니다.</p>}
    </HeroBand>
  );
}
