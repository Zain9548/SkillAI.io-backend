import React, { useState, useRef, useEffect } from "react";
import maleVideo from "../assets/videos/male-ai.mp4";
import femaleVideo from "../assets/videos/female-ai.mp4";
import Timer from "./Timer";
import { motion } from "motion/react";
import { FaMicrophone, FaMicrophoneSlash } from "react-icons/fa";
import axios from "axios";
import { ServerUrl } from "../App";
import { BsArrowRight } from "react-icons/bs";

function Step2Interview({ interviewData, onFinish }) {
  const { interviewId, questions, userName } = interviewData;

  const [isIntroPhase, setIsIntroPhase] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isAIPlaying, setIsAIPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [voiceGender, setVoiceGender] = useState("female");
  const [subtitle, setSubtitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(questions[0]?.timeLimit || 60);

  const recognitionRef = useRef(null);
  const videoRef = useRef(null);       // AI interviewer
  const cameraRef = useRef(null);      // Candidate camera

  const currentQuestion = questions[currentIndex];

  /* ---------------- CAMERA START ---------------- */

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });

        if (cameraRef.current) {
          cameraRef.current.srcObject = stream;
        }
      } catch (error) {
        console.log("Camera error:", error);
      }
    };

    startCamera();

    return () => {
      if (cameraRef.current?.srcObject) {
        cameraRef.current.srcObject
          .getTracks()
          .forEach((track) => track.stop());
      }
    };
  }, []);

  /* ---------------- LOAD VOICES ---------------- */

  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();

      if (!voices.length) return;

      const female =
        voices.find(v => v.name.toLowerCase().includes("zira")) ||
        voices.find(v => v.name.toLowerCase().includes("female"));

      if (female) {
        setSelectedVoice(female);
        setVoiceGender("female");
        return;
      }

      const male =
        voices.find(v => v.name.toLowerCase().includes("david")) ||
        voices.find(v => v.name.toLowerCase().includes("male"));

      if (male) {
        setSelectedVoice(male);
        setVoiceGender("male");
        return;
      }

      setSelectedVoice(voices[0]);
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const videoSource = voiceGender === "male" ? maleVideo : femaleVideo;

  /* ---------------- SPEAK FUNCTION ---------------- */

  const speakText = (text) => {
    return new Promise((resolve) => {
      if (!selectedVoice) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = selectedVoice;
      utterance.rate = 0.92;

      utterance.onstart = () => {
        setIsAIPlaying(true);
        stopMic();
        videoRef.current?.play();
      };

      utterance.onend = () => {
        videoRef.current?.pause();
        videoRef.current.currentTime = 0;
        setIsAIPlaying(false);

        if (isMicOn) startMic();

        setSubtitle("");
        resolve();
      };

      setSubtitle(text);
      window.speechSynthesis.speak(utterance);
    });
  };

  /* ---------------- INTRO + QUESTIONS ---------------- */

  useEffect(() => {
    if (!selectedVoice) return;

    const runIntro = async () => {
      if (isIntroPhase) {
        await speakText(
          `Hi ${userName}, it's great to meet you today. Let's begin the interview.`
        );
        setIsIntroPhase(false);
      } else if (currentQuestion) {
        await speakText(currentQuestion.question);
      }
    };

    runIntro();
  }, [selectedVoice, isIntroPhase, currentIndex]);

  /* ---------------- TIMER ---------------- */

  useEffect(() => {
    if (isIntroPhase) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [currentIndex]);

  /* ---------------- SPEECH RECOGNITION ---------------- */

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window)) return;

    const recognition = new window.webkitSpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;

    recognition.onresult = (event) => {
      const transcript =
        event.results[event.results.length - 1][0].transcript;

      setAnswer((prev) => prev + " " + transcript);
    };

    recognitionRef.current = recognition;
  }, []);

  const startMic = () => {
    if (recognitionRef.current && !isAIPlaying) {
      try {
        recognitionRef.current.start();
      } catch {}
    }
  };

  const stopMic = () => {
    recognitionRef.current?.stop();
  };

  const toggleMic = () => {
    if (isMicOn) stopMic();
    else startMic();

    setIsMicOn(!isMicOn);
  };

  /* ---------------- SUBMIT ANSWER ---------------- */

  const submitAnswer = async () => {
    if (isSubmitting) return;

    stopMic();
    setIsSubmitting(true);

    try {
      const result = await axios.post(
        ServerUrl + "/api/interview/submit-answer",
        {
          interviewId,
          questionIndex: currentIndex,
          answer,
          timeTaken: currentQuestion.timeLimit - timeLeft
        },
        { withCredentials: true }
      );

      setFeedback(result.data.feedback);
      speakText(result.data.feedback);

      setIsSubmitting(false);
    } catch (error) {
      console.log(error);
      setIsSubmitting(false);
    }
  };

  const handleNext = async () => {
    setAnswer("");
    setFeedback("");

    if (currentIndex + 1 >= questions.length) {
      finishInterview();
      return;
    }

    await speakText("Let's move to the next question.");

    setCurrentIndex(currentIndex + 1);
  };

  const finishInterview = async () => {
    stopMic();

    const result = await axios.post(
      ServerUrl + "/api/interview/finish",
      { interviewId },
      { withCredentials: true }
    );

    onFinish(result.data);
  };

  /* ---------------- UI ---------------- */

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">

      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl flex">

        {/* LEFT PANEL */}
        <div className="w-1/3 p-6 border-r">

          {/* AI Video */}
          <video
            src={videoSource}
            ref={videoRef}
            muted
            playsInline
            className="rounded-xl"
          />

          {/* Candidate Camera */}
          <div className="mt-6">
            <video
              ref={cameraRef}
              autoPlay
              muted
              playsInline
              className="rounded-xl border"
            />
          </div>

          {subtitle && (
            <p className="mt-4 text-gray-700 text-center">{subtitle}</p>
          )}

          <Timer
            timeLeft={timeLeft}
            totalTime={currentQuestion?.timeLimit}
          />
        </div>

        {/* RIGHT PANEL */}
        <div className="flex-1 p-8">

          <h2 className="text-2xl font-bold text-emerald-600 mb-6">
            AI Smart Interview
          </h2>

          {!isIntroPhase && (
            <div className="mb-6 bg-gray-100 p-4 rounded-xl">
              {currentQuestion?.question}
            </div>
          )}

          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="w-full h-40 border rounded-xl p-4"
          />

          {!feedback ? (
            <div className="flex gap-4 mt-6">

              <button
                onClick={toggleMic}
                className="w-14 h-14 bg-black text-white rounded-full flex items-center justify-center"
              >
                {isMicOn ? <FaMicrophone /> : <FaMicrophoneSlash />}
              </button>

              <button
                onClick={submitAnswer}
                disabled={isSubmitting}
                className="flex-1 bg-emerald-600 text-white rounded-xl"
              >
                {isSubmitting ? "Submitting..." : "Submit Answer"}
              </button>

            </div>
          ) : (
            <div className="mt-6">

              <p className="mb-4 text-emerald-700">{feedback}</p>

              <button
                onClick={handleNext}
                className="bg-emerald-600 text-white px-6 py-3 rounded-xl flex items-center gap-2"
              >
                Next Question <BsArrowRight />
              </button>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}

export default Step2Interview;