/**
 * A minimal React-compatible runtime for testing the browser-facing settings
 * module in Node.
 *
 * `react`/`react-dom` are browser-bundle dependencies in this deployment and are
 * not resolvable from Node, so the client module is exercised with a tiny
 * runtime that implements exactly what the page uses: `createElement`, state
 * hooks, `useEffect` (run once per dependency signature), and a synchronous
 * render pass that re-renders on state writes.
 * @module test/helpers/mini-react
 */

/**
 * Create one runtime + renderer pair.
 * @param {{deps?: unknown[]}} [options] - the dependency list every `useEffect` sees.
 * @returns {{react: object, render: Function, rerender: Function, nodes: Function, find: Function, text: Function, click: Function, change: Function}} the harness.
 */
export function createHarness({ deps = [] } = {}) {
  let hooks = [];
  let cursor = 0;
  let root = null;
  let lastTree = [];
  let pendingRerender = false;

  const useState = (initial) => {
    const index = cursor++;
    if (hooks.length <= index) hooks[index] = initial;
    const set = (next) => {
      hooks[index] = typeof next === 'function' ? next(hooks[index]) : next;
      pendingRerender = true;
    };
    return [hooks[index], set];
  };

  const useEffect = (effect) => {
    const index = cursor++;
    const signature = JSON.stringify(deps);
    const slot = hooks[index];
    if (slot !== undefined && slot.signature === signature) return;
    hooks[index] = { signature, cleanup: effect() };
  };

  const useMemo = (factory) => factory();
  const useCallback = (fn) => fn;
  const useRef = (initial) => {
    const index = cursor++;
    if (hooks.length <= index) hooks[index] = { current: initial };
    return hooks[index];
  };

  const Fragment = Symbol.for('mini-react.fragment');
  const createElement = (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
  });

  const react = { createElement, Fragment, useState, useEffect, useMemo, useCallback, useRef };

  const expand = (element) => {
    if (element === null || element === undefined || element === false) return [];
    if (typeof element === 'string' || typeof element === 'number') return [{ kind: 'text', text: String(element) }];
    if (Array.isArray(element)) return element.flatMap(expand);
    if (typeof element.type === 'function') return expand(element.type({ ...element.props, children: element.children }));
    return [{
      kind: 'element',
      type: element.type,
      props: element.props,
      children: element.children.flatMap(expand),
    }];
  };

  const render = (element) => {
    root = element;
    cursor = 0;
    pendingRerender = false;
    lastTree = expand(element);
    return lastTree;
  };

  const rerender = () => {
    cursor = 0;
    pendingRerender = false;
    lastTree = expand(root);
    return lastTree;
  };

  const walk = (list) => list.flatMap((node) => (node.kind === 'element' ? [node, ...walk(node.children)] : [node]));

  const nodes = () => walk(lastTree);

  const find = (predicate) => nodes().find((node) => node.kind === 'element' && predicate(node));

  const collect = (node) => (node.kind === 'text' ? node.text : node.children.map(collect).join(''));

  const text = (predicate) => {
    const target = predicate === undefined ? undefined : find(predicate);
    return target === undefined ? lastTree.map(collect).join('') : collect(target);
  };

  const settle = () => {
    if (pendingRerender) rerender();
  };

  const click = (target) => {
    if (target?.props?.onClick === undefined) throw new Error('mini-react: element has no onClick handler');
    target.props.onClick({ preventDefault() {} });
    settle();
  };

  const change = (target, value) => {
    if (target?.props?.onChange === undefined) throw new Error('mini-react: element has no onChange handler');
    target.props.onChange({ target: { value } });
    settle();
  };

  return { react, render, rerender, nodes, find, text, click, change, settle };
}
