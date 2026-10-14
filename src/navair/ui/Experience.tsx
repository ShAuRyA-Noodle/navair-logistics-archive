'use client';

/**
 * NAVAIR: the scroll experience.
 *
 * One sticky viewport, one tall track, one scrubbed master timeline. The stage
 * is a single <svg> driven by the orthographic engine; every chapter's copy
 * lives in the same timeline so scrolling back reverses everything exactly.
 *
 * Embedded in the logistics homepage by NavairSequence (the section shell that
 * owns the track height, the #services anchor and lazy mounting). This
 * component fills that shell; the .view is sticky, so the stage is pinned only
 * while the shell is on screen and releases on its own at the end.
 */

import { useEffect, useRef } from 'react';
import { CHAPTERS, DURATION, FEATURES, SERVICES } from '../story';
import { dotIcon } from './icons';
import './experience.css';

function Lines({ lines, className = '' }: { lines: (string | [string, string])[]; className?: string }) {
  return (
    <>
      {lines.map((l, i) => {
        const [txt, mod] = Array.isArray(l) ? l : [l, ''];
        return (
          <span key={i} className={`ln ${className} ${mod}`}>
            <span className="ln-i">{txt}</span>
          </span>
        );
      })}
    </>
  );
}

export default function Experience() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import('../boot').then(({ boot }) => {
      if (cancelled || !rootRef.current) return;
      dispose = boot(rootRef.current);
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return (
    <div className="nx" ref={rootRef} data-nx-state="booting">
      {/*
        Integration note: the standalone app's own <header className="hdr"> is retired here.
        On the Navair Logistics homepage the site navigation lives in <GlobeHero />.
      */}

      {/* ------------------------------------------------ sticky viewport (pinned only while the section is in view) */}
      <div className="view">
        <div className="back" aria-hidden="true">
          <div className="back__word" data-el="services-word">
            Everything freight needs&nbsp;&nbsp;/&nbsp;&nbsp;Everything freight needs
          </div>
        </div>

        <canvas className="stage stage--sea" aria-hidden="true" />
        <canvas
          className="stage stage--main"
          role="img"
          aria-label="A NAVAIR container is lifted from the stack, handed to a truck, driven to the port and loaded onto a ship."
        />

        {/* Services panel content (sits in the rising dark ground band) */}
        <div className="panel" data-el="panel">
          <div className="panel__head" data-el="panel-head">
            <p className="eyebrow eyebrow--inv">
              <span className="dot" /> Services
            </p>
            <h2 className="h-lg h-inv">
              <Lines lines={['Everything freight needs.', ['Under one operator.', 'is-note']]} />
            </h2>
          </div>
          <div className="panel__rail">
          <ul className="panel__cards" data-el="cards">
            {SERVICES.map(([n, t, d]) => (
              <li className="card" key={n}>
                <span className="card__n">{n}</span>
                <h3 className="card__t">{t}</h3>
                <p className="card__d">{d}</p>
                <span className="card__rule" />
              </li>
            ))}
          </ul>
          </div>
        </div>

        {/* ------------------------------------------------ chapter frames */}
        <div className="front">
          <section className="fr fr--hero" data-fr="hero">
            <div className="fr__in">
            <p className="eyebrow" data-el>
              <span className="dot" /> Freight forwarding, land transport, customs
            </p>
            <h2 className="h-xl">
              <Lines lines={['One box.', ['Every mile.', 'is-accent']]} />
            </h2>
            <p className="lede" data-el>
              Forwarding, trucking and customs brokerage under one accountable team. Follow a single NAVAIR container
              from the stack to the sea.
            </p>
            <div className="hero-cta" data-el>
              <a className="btn btn--solid" href="#enquiry">
                Start a shipment
              </a>
            </div>
            </div>
          </section>

          <section className="fr fr--lift" data-fr="lift">
            <p className="eyebrow" data-el>
              <span className="dot" /> First lift
            </p>
            <h2 className="h-lg">
              <Lines lines={[['Lifted', 'is-note'], 'with intent.']} />
            </h2>
            <p className="body" data-el>
              Weights verified, twistlocks confirmed, window booked. Nothing leaves our yard on a guess.
            </p>
            <dl className="stats" data-el>
              <div>
                <dt>Moves a month</dt>
                <dd data-count="3184" data-suffix="">
                  0
                </dd>
              </div>
              <div>
                <dt>On-time handover</dt>
                <dd data-count="98.6" data-suffix="%" data-dec="1">
                  0
                </dd>
              </div>
              <div>
                <dt>Years operating</dt>
                <dd data-count="11" data-suffix="">
                  0
                </dd>
              </div>
            </dl>
          </section>

          <section className="fr fr--handover" data-fr="handover">
            <p className="eyebrow" data-el>
              <span className="dot" /> Handover
            </p>
            <h2 className="h-lg">
              <Lines lines={['One chain', ['of custody.', 'is-note']]} />
            </h2>
            <p className="body" data-el>
              The same team that lifts the box drives it. No hand-offs between vendors, no finger-pointing when a
              window moves.
            </p>
          </section>

          <section className="fr fr--route" data-fr="route">
            <p className="eyebrow" data-el>
              <span className="dot" /> The route
            </p>
            <h2 className="h-lg">
              <Lines lines={[['On time', 'is-note'], 'at every turn.']} />
            </h2>
            <p className="body" data-el>
              Planned before it is driven. Every junction, every slot, every berth window is known before the wheels
              turn.
            </p>
          </section>

          <aside className="fr fr--features" data-fr="features">
            {FEATURES.map(([t, d], i) => (
              <div className="feat" key={t} data-el>
                <span className="feat__ic" dangerouslySetInnerHTML={{ __html: dotIcon(['pin', 'globe', 'headset'][i], 64) }} />
                <h3 className="feat__t">{t}</h3>
                <p className="feat__d">{d}</p>
              </div>
            ))}
          </aside>

          <section className="fr fr--berth" data-fr="berth">
            <p className="eyebrow" data-el>
              <span className="dot" /> The berth
            </p>
            <h2 className="h-lg">
              <Lines lines={['Delivered', ['to the berth.', 'is-note']]} />
            </h2>
            <p className="body" data-el>
              Gate-in, customs cleared, stowed in its slot. The box you saw lifted is the box that sails.
            </p>
          </section>

          <section className="fr fr--sea" data-fr="sea">
            <p className="eyebrow eyebrow--inv" data-el>
              <span className="dot" /> Open water
            </p>
            <h2 className="h-xl h-inv">
              <Lines lines={['Wherever', ['it’s going.', 'is-note']]} />
            </h2>
            <div className="sea-cta" data-el>
              <a className="btn btn--light" href="#enquiry">
                Start an enquiry
              </a>
              <p className="body body--inv">One operator from origin to destination. Tell us where the box goes next.</p>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------ HUD */}
        <div className="hud">
          <div className="speedo" data-el="speedo">
            <span className="speedo__v" data-el="speedo-v">
              00
            </span>
            <span className="speedo__u">km/h</span>
          </div>
          <div className="hud__chapter">
            <span className="hud__idx" data-el="hud-idx">
              01
            </span>
            <span className="hud__sep">/</span>
            <span className="hud__tot">{String(CHAPTERS.length).padStart(2, '0')}</span>
            <span className="hud__label" data-el="hud-label">
              {CHAPTERS[0].label}
            </span>
          </div>
          <div className="hud__telemetry" data-el="telemetry">
            NAVU 400 117 2
          </div>
          <div className="hud__spine">
            {CHAPTERS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="hud__tick"
                data-t={c.t}
                style={{ left: `${(c.t / DURATION) * 100}%` }}
                aria-label={`Jump to ${c.label}`}
              />
            ))}
            <span className="hud__fill" data-el="spine-fill" />
          </div>
        </div>

        {/* ------------------------------------------------ handoff: container doors
            The globe hero is deep navy; the yard is daylight. The section opens as the
            hero box's own doors (its real markings), swung open by scroll, so the colour
            change is a scene change rather than a seam. */}
        <div className="doors" aria-hidden="true">
          <span className="doors__head" />
          <div className="door door--l">
            <span className="door__rod" />
            <span className="door__rod" />
            <div className="door__mark">
              <b>NAVU 400117 2</b>
              <span>45G1</span>
            </div>
          </div>
          <div className="door door--r">
            <span className="door__rod" />
            <span className="door__rod" />
            <dl className="door__plate">
              <div><dt>Max gross</dt><dd>32,500 kg</dd></div>
              <div><dt>Tare</dt><dd>3,900 kg</dd></div>
              <div><dt>Payload</dt><dd>28,600 kg</dd></div>
            </dl>
          </div>
          <div className="doors__cue">
            <span className="doors__eyebrow">From the stack to the sea</span>
            <span className="doors__line" />
          </div>
        </div>
      </div>

      {/* The scroll track is the section shell itself (NavairSequence sets its height). The
          standalone app's custom cursor and loading veil are retired: the site has its own loader. */}
    </div>
  );
}
