import type { Scene } from './chart';

/** Draw a scene into an SVG element. The renderer knows nothing about maths. */
export function paintScene(svg: SVGSVGElement, scene: Scene): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', `0 0 ${scene.width} ${scene.height}`);
  svg.setAttribute('role', 'img');

  for (const shape of scene.shapes) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', shape.kind);

    switch (shape.kind) {
      case 'circle':
        el.setAttribute('cx', String(shape.cx));
        el.setAttribute('cy', String(shape.cy));
        el.setAttribute('r', String(shape.r));
        el.setAttribute('tabindex', '0');
        el.setAttribute('data-id', shape.id);
        if (shape.title) {
          el.setAttribute('aria-label', shape.title);
          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          title.textContent = shape.title;
          el.appendChild(title);
        }
        break;
      case 'path':
        el.setAttribute('d', shape.d);
        break;
      case 'line':
        el.setAttribute('x1', String(shape.x1));
        el.setAttribute('y1', String(shape.y1));
        el.setAttribute('x2', String(shape.x2));
        el.setAttribute('y2', String(shape.y2));
        break;
      case 'text':
        el.setAttribute('x', String(shape.x));
        el.setAttribute('y', String(shape.y));
        if (shape.anchor) el.setAttribute('text-anchor', shape.anchor);
        el.textContent = shape.text;
        break;
    }

    el.setAttribute('class', shape.cls);
    svg.appendChild(el);
  }
}
