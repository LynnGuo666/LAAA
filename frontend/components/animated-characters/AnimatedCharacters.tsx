'use client';

/**
 * 趣味登录动画角色群 —— 灵感来自 katavii/animated-login
 *
 * 四个小人站一排，眼睛跟随鼠标。配合密码输入框有四态：
 *  - idle：眼睛追鼠标，身体随鼠标轻微 skew
 *  - typing（用户名输入中）：紫色小人探身偷看，角色之间短暂对视
 *  - hiding（密码已输入但隐藏）：紫色小人捂眼/探头躲闪
 *  - showing（密码明文显示）：全体背过身、视线移开（"避嫌"）
 *
 * 纯客户端组件，用 GSAP 做平滑过渡 + requestAnimationFrame 驱动眼球追踪。
 */

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

interface AnimatedCharactersProps {
  /** 用户名输入框是否聚焦（触发"偷看"姿态） */
  isTyping?: boolean;
  /** 是否显示密码明文（触发"避嫌"姿态） */
  showPassword?: boolean;
  /** 密码长度（>0 才进入 hiding/showing 态） */
  passwordLength?: number;
}

// 单个眼球：白底 + 可移动的黑瞳孔
function EyeBall({
  size,
  pupilSize,
  maxDistance,
}: {
  size: number;
  pupilSize: number;
  maxDistance: number;
}) {
  return (
    <div
      className="eyeball"
      data-max-distance={maxDistance}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        willChange: 'height',
      }}
    >
      <div
        className="eyeball-pupil"
        style={{
          width: pupilSize,
          height: pupilSize,
          borderRadius: '50%',
          backgroundColor: '#2D2D2D',
          willChange: 'transform',
        }}
      />
    </div>
  );
}

// 裸瞳孔点（橙/黄小人用）
function Pupil({ size, maxDistance }: { size: number; maxDistance: number }) {
  return (
    <div
      className="pupil"
      data-max-distance={maxDistance}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: '#2D2D2D',
        willChange: 'transform',
      }}
    />
  );
}

export default function AnimatedCharacters({
  isTyping = false,
  showPassword = false,
  passwordLength = 0,
}: AnimatedCharactersProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const purpleFaceRef = useRef<HTMLDivElement>(null);
  const blackFaceRef = useRef<HTMLDivElement>(null);
  const orangeFaceRef = useRef<HTMLDivElement>(null);
  const yellowFaceRef = useRef<HTMLDivElement>(null);
  const yellowMouthRef = useRef<HTMLDivElement>(null);

  // quickTo 实例跨 effect 共享（rAF 循环与状态切换都需要）
  const qtRef = useRef<Record<string, gsap.QuickToFunc> | null>(null);
  // 最新的 props 塞进 ref，rAF 循环里读取，避免每次 props 变都重启循环
  const stateRef = useRef({
    isTyping: false,
    isHidingPassword: false,
    isShowingPassword: false,
    isLooking: false,
  });

  const isHiding = passwordLength > 0 && !showPassword;
  const isShowing = passwordLength > 0 && showPassword;

  useEffect(() => {
    stateRef.current.isTyping = isTyping;
    stateRef.current.isHidingPassword = isHiding;
    stateRef.current.isShowingPassword = isShowing;
  }, [isTyping, isHiding, isShowing]);

  useEffect(() => {
    const container = containerRef.current;
    const purple = purpleRef.current;
    const black = blackRef.current;
    const orange = orangeRef.current;
    const yellow = yellowRef.current;
    const purpleFace = purpleFaceRef.current;
    const blackFace = blackFaceRef.current;
    const orangeFace = orangeFaceRef.current;
    const yellowFace = yellowFaceRef.current;
    const yellowMouth = yellowMouthRef.current;
    if (
      !container || !purple || !black || !orange || !yellow ||
      !purpleFace || !blackFace || !orangeFace || !yellowFace || !yellowMouth
    ) {
      return;
    }

    const mouse = { x: 0, y: 0 };

    // GSAP quickTo：高频更新下比 gsap.to 更平滑、更省
    const qt = {
      purpleSkew: gsap.quickTo(purple, 'skewX', { duration: 0.3, ease: 'power2.out' }),
      blackSkew: gsap.quickTo(black, 'skewX', { duration: 0.3, ease: 'power2.out' }),
      orangeSkew: gsap.quickTo(orange, 'skewX', { duration: 0.3, ease: 'power2.out' }),
      yellowSkew: gsap.quickTo(yellow, 'skewX', { duration: 0.3, ease: 'power2.out' }),
      purpleX: gsap.quickTo(purple, 'x', { duration: 0.3, ease: 'power2.out' }),
      blackX: gsap.quickTo(black, 'x', { duration: 0.3, ease: 'power2.out' }),
      purpleHeight: gsap.quickTo(purple, 'height', { duration: 0.3, ease: 'power2.out' }),
      purpleFaceLeft: gsap.quickTo(purpleFace, 'left', { duration: 0.3, ease: 'power2.out' }),
      purpleFaceTop: gsap.quickTo(purpleFace, 'top', { duration: 0.3, ease: 'power2.out' }),
      blackFaceLeft: gsap.quickTo(blackFace, 'left', { duration: 0.3, ease: 'power2.out' }),
      blackFaceTop: gsap.quickTo(blackFace, 'top', { duration: 0.3, ease: 'power2.out' }),
      orangeFaceX: gsap.quickTo(orangeFace, 'x', { duration: 0.2, ease: 'power2.out' }),
      orangeFaceY: gsap.quickTo(orangeFace, 'y', { duration: 0.2, ease: 'power2.out' }),
      yellowFaceX: gsap.quickTo(yellowFace, 'x', { duration: 0.2, ease: 'power2.out' }),
      yellowFaceY: gsap.quickTo(yellowFace, 'y', { duration: 0.2, ease: 'power2.out' }),
      mouthX: gsap.quickTo(yellowMouth, 'x', { duration: 0.2, ease: 'power2.out' }),
      mouthY: gsap.quickTo(yellowMouth, 'y', { duration: 0.2, ease: 'power2.out' }),
    };
    qtRef.current = qt;

    const calcPos = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 3;
      const dx = mouse.x - cx;
      const dy = mouse.y - cy;
      return {
        faceX: Math.max(-15, Math.min(15, dx / 20)),
        faceY: Math.max(-10, Math.min(10, dy / 30)),
        bodySkew: Math.max(-6, Math.min(6, -dx / 120)),
      };
    };

    const calcEyePos = (el: HTMLElement, maxDist: number) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = mouse.x - cx;
      const dy = mouse.y - cy;
      const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
      const angle = Math.atan2(dy, dx);
      return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
    };

    let rafId = 0;
    const tick = () => {
      const { isTyping: typing, isHidingPassword: hiding, isShowingPassword: showing, isLooking: looking } = stateRef.current;

      if (!showing) {
        const pp = calcPos(purple);
        if (typing || hiding) {
          qt.purpleSkew(pp.bodySkew - 12);
          qt.purpleX(40);
          qt.purpleHeight(440);
        } else {
          qt.purpleSkew(pp.bodySkew);
          qt.purpleX(0);
          qt.purpleHeight(400);
        }
      }

      if (!showing) {
        const bp = calcPos(black);
        if (looking) {
          qt.blackSkew(bp.bodySkew * 1.5 + 10);
          qt.blackX(20);
        } else if (typing || hiding) {
          qt.blackSkew(bp.bodySkew * 1.5);
          qt.blackX(0);
        } else {
          qt.blackSkew(bp.bodySkew);
          qt.blackX(0);
        }
      }

      if (!showing) {
        qt.orangeSkew(calcPos(orange).bodySkew);
        qt.yellowSkew(calcPos(yellow).bodySkew);
      }

      if (!showing && !looking) {
        const pp = calcPos(purple);
        const purpleFaceX = pp.faceX >= 0 ? Math.min(25, pp.faceX * 1.5) : pp.faceX;
        qt.purpleFaceLeft(45 + purpleFaceX);
        qt.purpleFaceTop(40 + pp.faceY);
      }
      if (!showing && !looking) {
        const bp = calcPos(black);
        qt.blackFaceLeft(26 + bp.faceX);
        qt.blackFaceTop(32 + bp.faceY);
      }
      if (!showing) {
        const op = calcPos(orange);
        qt.orangeFaceX(op.faceX);
        qt.orangeFaceY(op.faceY);
        const yp = calcPos(yellow);
        qt.yellowFaceX(yp.faceX);
        qt.yellowFaceY(yp.faceY);
        qt.mouthX(yp.faceX);
        qt.mouthY(yp.faceY);
      }

      // 瞳孔追鼠标（showing 态下由状态切换 effect 接管，不在这里覆盖）
      if (!showing) {
        const pupils = container.querySelectorAll<HTMLElement>('.pupil');
        pupils.forEach((p) => {
          const maxDist = Number(p.dataset.maxDistance) || 5;
          const ePos = calcEyePos(p, maxDist);
          gsap.set(p, { x: ePos.x, y: ePos.y });
        });
        if (!looking) {
          const eyeballs = container.querySelectorAll<HTMLElement>('.eyeball');
          eyeballs.forEach((eb) => {
            const maxDist = Number(eb.dataset.maxDistance) || 10;
            const pupil = eb.querySelector<HTMLElement>('.eyeball-pupil');
            if (!pupil) return;
            const ePos = calcEyePos(eb, maxDist);
            gsap.set(pupil, { x: ePos.x, y: ePos.y });
          });
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    gsap.set('.pupil', { x: 0, y: 0 });
    gsap.set('.eyeball-pupil', { x: 0, y: 0 });
    window.addEventListener('mousemove', onMove, { passive: true });
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(rafId);
      qtRef.current = null;
    };
  }, []);

  // 随机眨眼（紫、黑小人）
  useEffect(() => {
    const targets: { eyeballs: HTMLElement[]; size: number }[] = [];
    if (purpleRef.current) {
      targets.push({
        eyeballs: Array.from(purpleRef.current.querySelectorAll<HTMLElement>('.eyeball')),
        size: 18,
      });
    }
    if (blackRef.current) {
      targets.push({
        eyeballs: Array.from(blackRef.current.querySelectorAll<HTMLElement>('.eyeball')),
        size: 16,
      });
    }
    if (targets.length === 0) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    targets.forEach(({ eyeballs, size }) => {
      const scheduleBlink = () => {
        const t = setTimeout(() => {
          eyeballs.forEach((el) => gsap.to(el, { height: 2, duration: 0.08, ease: 'power2.in' }));
          const t2 = setTimeout(() => {
            eyeballs.forEach((el) => gsap.to(el, { height: size, duration: 0.08, ease: 'power2.out' }));
            scheduleBlink();
          }, 150);
          timers.push(t2);
        }, Math.random() * 4000 + 3000);
        timers.push(t);
      };
      scheduleBlink();
    });

    return () => timers.forEach(clearTimeout);
  }, []);

  // 状态切换：对视 / 捂眼 / 避嫌
  useEffect(() => {
    const qt = qtRef.current;
    if (!qt) return;
    const purplePupils = purpleRef.current?.querySelectorAll<HTMLElement>('.eyeball-pupil') ?? [];
    const blackPupils = blackRef.current?.querySelectorAll<HTMLElement>('.eyeball-pupil') ?? [];
    const orangePupils = orangeRef.current?.querySelectorAll<HTMLElement>('.pupil') ?? [];
    const yellowPupils = yellowRef.current?.querySelectorAll<HTMLElement>('.pupil') ?? [];

    // 显示密码 → 避嫌：全体视线移开、身体回正
    if (isShowing) {
      qt.purpleSkew(0); qt.blackSkew(0); qt.orangeSkew(0); qt.yellowSkew(0);
      qt.purpleX(0); qt.blackX(0); qt.purpleHeight(400);
      qt.purpleFaceLeft(20); qt.purpleFaceTop(35);
      qt.blackFaceLeft(10); qt.blackFaceTop(28);
      qt.orangeFaceX(50 - 82); qt.orangeFaceY(85 - 90);
      qt.yellowFaceX(20 - 52); qt.yellowFaceY(35 - 40);
      qt.mouthX(10 - 40); qt.mouthY(0);
      purplePupils.forEach((p) => gsap.to(p, { x: -4, y: -4, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }));
      blackPupils.forEach((p) => gsap.to(p, { x: -4, y: -4, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }));
      orangePupils.forEach((p) => gsap.to(p, { x: -5, y: -4, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }));
      yellowPupils.forEach((p) => gsap.to(p, { x: -5, y: -4, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }));
      return;
    }

    // 隐藏密码 → 紫色小人捂眼探头
    if (isHiding) {
      qt.purpleFaceLeft(55);
      qt.purpleFaceTop(65);
    }

    // 输入用户名 → 短暂对视
    if (isTyping) {
      stateRef.current.isLooking = true;
      qt.purpleFaceLeft(55); qt.purpleFaceTop(65);
      qt.blackFaceLeft(32); qt.blackFaceTop(12);
      purplePupils.forEach((p) => gsap.to(p, { x: 3, y: 4, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }));
      blackPupils.forEach((p) => gsap.to(p, { x: 0, y: -4, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }));
      const t = setTimeout(() => {
        stateRef.current.isLooking = false;
        purplePupils.forEach((p) => gsap.killTweensOf(p));
      }, 800);
      return () => clearTimeout(t);
    }
  }, [isTyping, isHiding, isShowing]);

  // 显示密码时，紫色小人周期性偷瞄一眼
  useEffect(() => {
    if (!isShowing) return;
    const purplePupils = purpleRef.current?.querySelectorAll<HTMLElement>('.eyeball-pupil') ?? [];
    if (purplePupils.length === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedulePeek = () => {
      const t = setTimeout(() => {
        purplePupils.forEach((p) => gsap.to(p, { x: 4, y: 5, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }));
        const qt = qtRef.current;
        if (qt) {
          qt.purpleFaceLeft(20); qt.purpleFaceTop(35);
        }
        const t2 = setTimeout(() => {
          purplePupils.forEach((p) => gsap.to(p, { x: -4, y: -4, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }));
          schedulePeek();
        }, 800);
        timers.push(t2);
      }, Math.random() * 3000 + 2000);
      timers.push(t);
    };
    schedulePeek();
    return () => timers.forEach(clearTimeout);
  }, [isShowing]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: 550, height: 400 }}>
      {/* 紫色小人（最高，主偷看者） */}
      <div
        ref={purpleRef}
        style={{
          position: 'absolute', bottom: 0, left: 70, width: 180, height: 400,
          backgroundColor: '#6C3FF5', borderRadius: '10px 10px 0 0', zIndex: 1,
          transformOrigin: 'bottom center', willChange: 'transform',
        }}
      >
        <div ref={purpleFaceRef} style={{ position: 'absolute', display: 'flex', gap: 32, left: 45, top: 40 }}>
          <EyeBall size={18} pupilSize={7} maxDistance={5} />
          <EyeBall size={18} pupilSize={7} maxDistance={5} />
        </div>
      </div>

      {/* 黑色小人 */}
      <div
        ref={blackRef}
        style={{
          position: 'absolute', bottom: 0, left: 240, width: 120, height: 310,
          backgroundColor: '#2D2D2D', borderRadius: '8px 8px 0 0', zIndex: 2,
          transformOrigin: 'bottom center', willChange: 'transform',
        }}
      >
        <div ref={blackFaceRef} style={{ position: 'absolute', display: 'flex', gap: 24, left: 26, top: 32 }}>
          <EyeBall size={16} pupilSize={6} maxDistance={4} />
          <EyeBall size={16} pupilSize={6} maxDistance={4} />
        </div>
      </div>

      {/* 橘色小人（矮，圆顶） */}
      <div
        ref={orangeRef}
        style={{
          position: 'absolute', bottom: 0, left: 0, width: 240, height: 200,
          backgroundColor: '#FF9B6B', borderRadius: '120px 120px 0 0', zIndex: 3,
          transformOrigin: 'bottom center', willChange: 'transform',
        }}
      >
        <div ref={orangeFaceRef} style={{ position: 'absolute', display: 'flex', gap: 32, left: 82, top: 90 }}>
          <Pupil size={12} maxDistance={5} />
          <Pupil size={12} maxDistance={5} />
        </div>
      </div>

      {/* 黄色小人（带嘴） */}
      <div
        ref={yellowRef}
        style={{
          position: 'absolute', bottom: 0, left: 310, width: 140, height: 230,
          backgroundColor: '#E8D754', borderRadius: '70px 70px 0 0', zIndex: 4,
          transformOrigin: 'bottom center', willChange: 'transform',
        }}
      >
        <div ref={yellowFaceRef} style={{ position: 'absolute', display: 'flex', gap: 24, left: 52, top: 40 }}>
          <Pupil size={12} maxDistance={5} />
          <Pupil size={12} maxDistance={5} />
        </div>
        <div
          ref={yellowMouthRef}
          style={{ position: 'absolute', width: 80, height: 4, backgroundColor: '#2D2D2D', borderRadius: 9999, left: 40, top: 88 }}
        />
      </div>
    </div>
  );
}
