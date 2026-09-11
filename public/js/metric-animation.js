/**
 * Small reusable counter utility for dashboard metrics. Each element retains
 * its latest value so a later dashboard refresh animates from what is visible.
 */
(function registerMetricAnimation(globalScope) {
  const animationState = new WeakMap();

  function normalizeMetricValue(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
    return Math.min(Math.floor(numericValue), Number.MAX_SAFE_INTEGER);
  }

  function formatMetricValue(value, locale) {
    return new Intl.NumberFormat(locale).format(normalizeMetricValue(value));
  }

  function metricTextValue(element) {
    const storedValue = element?.dataset?.metricValue;
    if (storedValue !== undefined) return normalizeMetricValue(storedValue);
    return normalizeMetricValue(String(element?.textContent || '').replace(/[^0-9.-]/g, ''));
  }

  function setAnimating(element, isAnimating) {
    if (!element?.classList) return;
    if (typeof element.classList.toggle === 'function') {
      element.classList.toggle('is-animating', isAnimating);
    } else if (isAnimating && typeof element.classList.add === 'function') {
      element.classList.add('is-animating');
    } else if (!isAnimating && typeof element.classList.remove === 'function') {
      element.classList.remove('is-animating');
    }
  }

  function prefersReducedMotion(options) {
    if (typeof options.reducedMotion === 'boolean') return options.reducedMotion;
    return Boolean(globalScope?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  function animateMetric(element, target, options = {}) {
    if (!element) return 0;

    const finalValue = normalizeMetricValue(target);
    const previousAnimation = animationState.get(element);
    const cancelFrame = options.cancelAnimationFrame || globalScope?.cancelAnimationFrame?.bind(globalScope);
    if (previousAnimation?.frameId !== null && previousAnimation?.frameId !== undefined && typeof cancelFrame === 'function') {
      cancelFrame(previousAnimation.frameId);
    }

    const startingValue = previousAnimation ? previousAnimation.value : metricTextValue(element);
    const render = value => {
      const normalizedValue = normalizeMetricValue(value);
      element.textContent = formatMetricValue(normalizedValue, options.locale);
      if (element.dataset) element.dataset.metricValue = String(normalizedValue);
    };
    const requestFrame = options.requestAnimationFrame || globalScope?.requestAnimationFrame?.bind(globalScope);
    const requestedDuration = Number(options.duration);
    const duration = Number.isFinite(requestedDuration)
      ? Math.max(0, Math.min(requestedDuration, 1000))
      : 750;

    if (prefersReducedMotion(options) || startingValue === finalValue || typeof requestFrame !== 'function' || duration === 0) {
      render(finalValue);
      setAnimating(element, false);
      animationState.set(element, { frameId: null, value: finalValue });
      return finalValue;
    }

    const animation = { frameId: null, value: startingValue };
    animationState.set(element, animation);
    setAnimating(element, true);
    render(startingValue);
    let startedAt = null;

    const tick = timestamp => {
      if (animationState.get(element) !== animation) return;
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / duration));
      // Ease-out keeps the value readable while still ending precisely on target.
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      animation.value = Math.round(startingValue + ((finalValue - startingValue) * easedProgress));
      render(animation.value);

      if (progress < 1) {
        animation.frameId = requestFrame(tick);
      } else {
        animation.value = finalValue;
        animation.frameId = null;
        render(finalValue);
        setAnimating(element, false);
      }
    };

    animation.frameId = requestFrame(tick);
    return finalValue;
  }

  const api = { animateMetric, formatMetricValue, normalizeMetricValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.DashboardMetricUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
