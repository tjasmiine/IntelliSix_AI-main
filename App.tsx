
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  LearningState, 
  QuizStatus, 
  ScoreLevel, 
  ImprovementStatus, 
  ErrorPattern, 
  EngagementStatus, 
  PerformanceClassification,
  LearningMaterial,
  LogEntry
} from './types';
import { INITIAL_STATE, INITIAL_MATERIALS, TOPIC_QUIZZES, GOAL_STATE, BASIC_MATERIAL } from './constants';
import LearningPath from './components/LearningPath';
import QuizModule from './components/QuizModule';
import StudyViewer from './components/StudyViewer';
import Chatbot from './components/Chatbot';
import NotificationBanner from './components/NotificationBanner';

const App: React.FC = () => {
  const [state, setState] = useState<LearningState>(INITIAL_STATE);
  const [materials, setMaterials] = useState<LearningMaterial[]>(INITIAL_MATERIALS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [quizSession, setQuizSession] = useState<{ topicId: string, index: number } | null>(null);
  const [quizFinished, setQuizFinished] = useState(false);
  const [lastScore, setLastScore] = useState(0);
  const [lastRawScore, setLastRawScore] = useState<{score: number, total: number} | null>(null);
  const [motivation, setMotivation] = useState<string | null>(null);
  const [viewingMaterial, setViewingMaterial] = useState<LearningMaterial | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          console.log("No API Key selected yet. User might need to open selection dialog.");
        }
      }
    };
    checkKey();
  }, []);

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [
      {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        type,
        message
      },
      ...prev
    ]);
  }, []);

  useEffect(() => {
    if (quizSession) return;

    const evaluateRules = () => {
      const foundationalMaterials = materials.filter(m => m.level === 'Foundational');
      const basicMaterial = materials.find(m => m.id === BASIC_MATERIAL.id);
      const basicMaterialExists = !!basicMaterial;
      
      // Check if any foundational quiz has a score below 50%
      const hasFoundationalCriticalFail = foundationalMaterials.some(m => {
        const scores = Object.values(m.assessmentScores || {}) as number[];
        return scores.some(s => s < 50);
      });

      // UPDATED LOGIC: Unlock basic module immediately upon ANY foundational failure (< 50%)
      if (hasFoundationalCriticalFail && !basicMaterialExists) {
        addLog('REASONING', 'Gating Check: Foundational failure detected (< 50%). Unlocking Basic Module for remedial support.');
        setMaterials(prev => [BASIC_MATERIAL, ...prev]);
        setMotivation("Basic module unlocked. We noticed you're struggling with some core concepts. Please complete these basic skills to build a stronger foundation!");
        return;
      }

      // Check if all foundational topics have been cleared with at least 50%
      const allFoundationalPassedThreshold = foundationalMaterials.every(m => {
        const scores = Object.values(m.assessmentScores || {}) as number[];
        return scores.length > 0 && scores.every(s => s >= 50);
      });

      let basicPassedThreshold = true;
      if (basicMaterialExists && basicMaterial) {
          const scores = Object.values(basicMaterial.assessmentScores || {}) as number[];
          // If basic exists, it must also be passed with 50%
          basicPassedThreshold = scores.length > 0 && scores.every(s => s >= 50);
      }

      const noCriticalFailures = materials.every(m => {
        const scores = Object.values(m.assessmentScores || {}) as number[];
        return scores.every(s => s >= 50);
      });

      const advancedLocked = materials.some(m => m.level === 'Advanced' && m.locked);

      // Advanced unlocks only when both foundational and basic (if unlocked) are passed at 50%
      if (allFoundationalPassedThreshold && basicPassedThreshold && noCriticalFailures && advancedLocked) {
        addLog('REASONING', 'Unlocking Advanced: 50% threshold met across all required modules.');
        setMaterials(prev => prev.map(m => m.level === 'Advanced' ? { ...m, locked: false } : m));
        setMotivation("Advanced material is now available! Great job recovering your score.");
        return;
      }

      // Re-lock if new failures appear
      if (!noCriticalFailures && !advancedLocked) {
        setMaterials(prev => prev.map(m => m.level === 'Advanced' ? { ...m, locked: true } : m));
        setMotivation("Advanced material relocked. Maintain at least 50% on all quizzes to stay in advanced mode.");
        return;
      }
    };
    evaluateRules();
  }, [materials, quizSession, addLog]);

  const handleStartStudy = (material: LearningMaterial) => {
    addLog('SENSOR', `User opened study notes for ${material.title}`);
    setViewingMaterial(material);
    setQuizSession(null);
    setQuizFinished(false);
  };

  const handleCloseStudy = () => setViewingMaterial(null);

  const handleStartQuiz = (topicId: string, index: number) => {
    addLog('SENSOR', `User started Assessment ${index + 1} for topic ${topicId}`);
    setQuizSession({ topicId, index });
    setViewingMaterial(null);
    setQuizFinished(false);
    setMotivation(null);
  };

  const handleQuitQuiz = useCallback(() => {
    addLog('SENSOR', `Assessment aborted by user.`);
    setQuizSession(null);
    setQuizFinished(false);
  }, [addLog]);

  const handleQuizSubmit = (score: number, errors: number) => {
    if (!quizSession) return;
    
    const currentQuizCount = TOPIC_QUIZZES[quizSession.topicId][quizSession.index].length;
    const percentage = Math.round((Math.min(score, currentQuizCount) / currentQuizCount) * 100);
    setLastScore(percentage);
    setLastRawScore({ score, total: currentQuizCount });

    addLog('SENSOR', `Quiz Result: ${percentage}%`);

    setMaterials(prev => prev.map(m => {
      if (m.id === quizSession.topicId) {
        const newCompleted = m.completedAssessments.includes(quizSession.index)
          ? m.completedAssessments
          : [...m.completedAssessments, quizSession.index];
        const newScores = { ...(m.assessmentScores || {}), [quizSession.index]: percentage };
        return { ...m, completedAssessments: newCompleted, assessmentScores: newScores };
      }
      return m;
    }));

    setState(prev => ({
      ...prev,
      qs: QuizStatus.COMPLETED,
      sl: percentage < 50 ? ScoreLevel.LOW : percentage < 100 ? ScoreLevel.MEDIUM : ScoreLevel.HIGH,
      pc: percentage === 100 ? PerformanceClassification.HIGH : PerformanceClassification.LOW
    }));

    setQuizSession(null);
    setQuizFinished(true);
  };

  const completionPercentage = useMemo(() => {
    let perfectQuizzes = 0;
    let totalQuizzesPossible = 0;

    materials.forEach(material => {
      const assessments = TOPIC_QUIZZES[material.id];
      if (assessments) {
        totalQuizzesPossible += assessments.length;
        const scores = Object.values(material.assessmentScores || {});
        perfectQuizzes += scores.filter(s => s === 100).length;
      }
    });

    if (totalQuizzesPossible === 0) return 0;
    return Math.round((perfectQuizzes / totalQuizzesPossible) * 100);
  }, [materials]);

  return (
    <div className="min-h-screen bg-[#FDFDFF] text-slate-900 pb-20 flex flex-col">
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-100 px-6 py-4 shrink-0">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white text-2xl shadow-xl shadow-indigo-100">
              <i className="fa-solid fa-database"></i>
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-800">IntelliSix DB</h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Completion Tracking</p>
            </div>
          </div>

          <div className="flex-1 max-w-md mx-auto w-full">
            <div className="flex justify-between items-center mb-1.5 px-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Course Completion (100% Mastery)</span>
              <span className="text-[10px] font-black text-indigo-600 uppercase">{completionPercentage}%</span>
            </div>
            <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-50">
              <div 
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-1000 ease-out"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 w-full flex-1 flex flex-col">
        <NotificationBanner message={motivation} onClose={() => setMotivation(null)} />

        <div className="flex-1 flex flex-col mt-6">
            {quizSession ? (
              <div className="animate-in fade-in zoom-in-95 duration-300 h-[calc(100vh-180px)] min-h-[500px]">
                <QuizModule 
                  questions={TOPIC_QUIZZES[quizSession.topicId][quizSession.index]} 
                  onFinish={handleQuizSubmit} 
                  onQuit={handleQuitQuiz}
                />
              </div>
            ) : viewingMaterial ? (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-[calc(100vh-180px)] min-h-[500px]">
                <StudyViewer 
                  material={viewingMaterial}
                  onClose={handleCloseStudy}
                  onStartQuiz={(idx) => handleStartQuiz(viewingMaterial.id, idx)}
                />
              </div>
            ) : quizFinished ? (
              <div className="bg-white p-10 rounded-3xl border border-slate-100 shadow-xl text-center animate-in zoom-in-95 duration-500 my-auto">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl ${
                  lastScore < 50 ? 'bg-red-50 text-red-500' : lastScore < 100 ? 'bg-amber-50 text-amber-500' : 'bg-green-50 text-green-600'
                }`}>
                  <i className={`fa-solid ${lastScore < 50 ? 'fa-xmark' : lastScore < 100 ? 'fa-check' : 'fa-star'}`}></i>
                </div>
                <h2 className="text-2xl font-black text-slate-800">
                  {lastScore === 100 ? 'Perfect Completion!' : lastScore >= 50 ? 'Assessment Passed' : 'Assessment Failed'}
                </h2>
                <div className={`text-6xl font-black mt-6 mb-2 ${
                  lastScore < 50 ? 'text-red-500' : lastScore < 100 ? 'text-amber-500' : 'text-green-600'
                }`}>{lastScore}%</div>
                <div className="text-lg text-slate-500 font-bold mb-8">
                  {lastScore === 100 ? "Score contributes to total completion." : "Try again for 100% to fill your completion bar."}
                </div>
                <button 
                  onClick={() => setQuizFinished(false)}
                  className="bg-indigo-600 text-white px-10 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95"
                >
                  Return to Learning Path
                </button>
              </div>
            ) : (
              <section className="space-y-6 pb-20">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">Learning Journey</h2>
                  <button 
                    onClick={() => window.location.reload()}
                    className="text-[10px] font-black uppercase text-slate-400 hover:text-indigo-600 transition-colors"
                  >
                    <i className="fa-solid fa-rotate-right mr-1"></i> Reset App
                  </button>
                </div>
                <LearningPath 
                  materials={materials} 
                  onMaterialClick={handleStartStudy}
                  onTakeQuiz={(topicId, idx) => handleStartQuiz(topicId, idx)}
                />
              </section>
            )}
        </div>
      </main>

      <Chatbot 
        state={state} 
        onEngage={() => addLog('SENSOR', 'User engaged tutor')} 
        onResponse={() => addLog('ACTUATOR', 'AI response generated')}
      />
    </div>
  );
};

export default App;
