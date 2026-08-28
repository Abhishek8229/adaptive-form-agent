import { detectPage, getVisualContext } from '../src/content/detector.ts';
(window as any).detectPage = detectPage;
(window as any).getVisualContext = getVisualContext;
