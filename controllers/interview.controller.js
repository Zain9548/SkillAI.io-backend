import fs from "fs"
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs"
import { askAi } from "../services/openRouter.service.js"
import User from "../models/user.model.js"
import Interview from "../models/interview.model.js"



/* -----------------------------
SAFE AI JSON PARSER
----------------------------- */

const parseAiJson = (response) => {
  try {
    return JSON.parse(response)
  } catch {

    const match = response.match(/\{[\s\S]*\}/)

    if (!match) {
      throw new Error("AI returned invalid JSON")
    }

    return JSON.parse(match[0])
  }
}


/* -----------------------------
KEYWORD SCORING
----------------------------- */

const keywordScore = (answer, question) => {

  const keywords = question
    .toLowerCase()
    .split(" ")
    .filter(w => w.length > 5)

  let matches = 0

  keywords.forEach(word => {
    if (answer.toLowerCase().includes(word)) {
      matches++
    }
  })

  const score = (matches / keywords.length) * 10

  return Math.min(10, Math.round(score))
}



/* -----------------------------
FOLLOW UP QUESTION GENERATOR
----------------------------- */

const generateFollowup = async (question, answer) => {

  const messages = [

    {
      role:"system",
      content:`
You are a senior interviewer.

Candidate gave weak answer.

Ask ONE follow-up question
to test deeper understanding.

Rules:
10-15 words
one sentence
simple English
`
    },

    {
      role:"user",
      content:`
Question: ${question}

Candidate Answer:
${answer}
`
    }

  ]

  const response = await askAi(messages)

  return response.trim()
}



/* -----------------------------
VOICE QUESTION GENERATOR
----------------------------- */

const generateVoiceText = async (question)=>{

const messages=[

{
role:"system",
content:`
Convert interview question into natural spoken style
for voice interviewer.

Keep same meaning.
`
},

{
role:"user",
content:question
}

]

const res = await askAi(messages)

return res.trim()

}



/* -----------------------------
CHEATING EVENT LOGGER
----------------------------- */

export const logCheatingEvent = async(req,res)=>{

try{

const {interviewId,event}=req.body

await Interview.updateOne(

{_id:interviewId},

{$push:{cheatingEvents:event}}

)

res.json({status:"logged"})

}catch(error){

return res.status(500).json({
message:`cheating event error ${error}`
})

}

}



/* -----------------------------
RESUME ANALYSIS
----------------------------- */

export const analyzeResume = async (req, res) => {

  try {

    if (!req.file) {
      return res.status(400).json({ message: "Resume required" })
    }

    const filepath = req.file.path

    const fileBuffer = await fs.promises.readFile(filepath)
    const uint8Array = new Uint8Array(fileBuffer)

    const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise

    let resumeText = ""

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {

      const page = await pdf.getPage(pageNum)
      const content = await page.getTextContent()

      const pageText = content.items.map(item => item.str).join(" ")

      resumeText += pageText + "\n"
    }

    resumeText = resumeText.replace(/\s+/g, " ").trim()


    const messages = [

      {
        role: "system",
        content: `
Extract structured information from the resume.

Return ONLY JSON:

{
 "role":"string",
 "experience":"string",
 "projects":["project1","project2"],
 "skills":["skill1","skill2","skill3","skill4"]
}
`
      },

      {
        role: "user",
        content: resumeText
      }

    ]


    const aiResponse = await askAi(messages)

    const parsed = parseAiJson(aiResponse)

    fs.unlinkSync(filepath)

    res.json({
      role: parsed.role || "Unknown",
      experience: parsed.experience || "Unknown",
      projects: parsed.projects || [],
      skills: parsed.skills || [],
      resumeText
    })

  } catch (error) {

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }

    return res.status(500).json({ message: error.message })
  }

}



/* -----------------------------
GENERATE INTERVIEW QUESTIONS
----------------------------- */

export const generateQuestion = async (req, res) => {

  try {

    let { role, experience, mode, resumeText, projects, skills, voiceMode } = req.body

    role = role?.trim()
    experience = experience?.trim()
    mode = mode?.trim()

    const user = await User.findById(req.userId)

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    if (user.credits < 50) {
      return res.status(400).json({
        message: "Minimum 50 credits required"
      })
    }

    const projectText = projects?.length ? projects.join(", ") : "None"
    const skillsText = skills?.length ? skills.join(", ") : "None"


    const messages = [

      {
        role: "system",
        content: `
Generate exactly 10 interview questions.

Simple English
one sentence
15-20 words
`
      },

      {
        role: "user",
        content: `
Role:${role}
Experience:${experience}

Skills:${skillsText}

Projects:${projectText}
`
      }

    ]


    const aiResponse = await askAi(messages)

    const questionsArray = aiResponse
      .split("\n")
      .map(q => q.trim())
      .filter(q => q.length > 10)
      .slice(0, 10)


    user.credits -= 50
    await user.save()


    const interview = await Interview.create({

      userId: user._id,
      role,
      experience,
      mode,
      resumeText,
      voiceMode:voiceMode || false,

      questions: questionsArray.map((q)=>({
        question:q
      }))

    })


    let voiceQuestions=[]

    if(voiceMode){

      for(let q of questionsArray){

        const voice=await generateVoiceText(q)

        voiceQuestions.push(voice)

      }

    }


    res.json({
      interviewId: interview._id,
      questions: interview.questions,
      voiceQuestions
    })

  } catch (error) {

    return res.status(500).json({
      message: `failed to create interview ${error.message}`
    })

  }

}



/* -----------------------------
SUBMIT ANSWER
----------------------------- */

export const submitAnswer = async (req, res) => {

  try {

    const { interviewId, questionIndex, answer } = req.body

    const interview = await Interview.findOne({
      _id: interviewId,
      userId: req.userId
    })

    const question = interview.questions[questionIndex]


    const messages = [

      {
        role: "system",
        content: `
Evaluate answer.

Return JSON:

{
confidence:number,
communication:number,
correctness:number,
finalScore:number,
feedback:"short feedback"
}
`
      },

      {
        role: "user",
        content: `
Question:${question.question}

Answer:${answer}
`
      }

    ]


    const aiResponse = await askAi(messages)

    const parsed = parseAiJson(aiResponse)

    const keyword = keywordScore(answer, question.question)

    const finalScore = Math.round(
      (parsed.finalScore * 0.7) +
      (keyword * 0.3)
    )


    question.answer = answer
    question.score = finalScore
    question.feedback = parsed.feedback

    await interview.save()


    let followup=null

    if(finalScore<=4){

      followup=await generateFollowup(
        question.question,
        answer
      )

    }


    return res.json({
      score: finalScore,
      feedback: parsed.feedback,
      followupQuestion: followup
    })

  } catch (error) {

    return res.status(500).json({
      message: `failed to submit answer ${error.message}`
    })

  }

}



/* -----------------------------
FINISH INTERVIEW
----------------------------- */

export const finishInterview = async (req,res) => {

  try {

    const { interviewId } = req.body

    const interview = await Interview.findOne({
      _id: interviewId,
      userId: req.userId
    })

    const totalQuestions = interview.questions.length

    let totalScore = 0

    interview.questions.forEach(q => {

      totalScore += q.score || 0

    })


    const finalScore = totalScore / totalQuestions

    interview.finalScore = finalScore
    interview.status = "completed"

    await interview.save()


    res.json({

      finalScore: Number(finalScore.toFixed(1)),
      questionWiseScore: interview.questions

    })

  } catch (error) {

    return res.status(500).json({
      message:`failed to finish interview ${error.message}`
    })

  }

}

export const getInterviewReport = async (req, res) => {
  try {

    const interview = await Interview.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!interview) {
      return res.status(404).json({
        message: "Interview not found"
      });
    }

    const totalQuestions = interview.questions.length;

    let totalScore = 0;

    interview.questions.forEach(q => {
      totalScore += q.score || 0;
    });

    const finalScore = totalScore / totalQuestions;

    res.json({
      finalScore: Number(finalScore.toFixed(1)),
      questionWiseScore: interview.questions
    });

  } catch (error) {

    return res.status(500).json({
      message: `failed to fetch interview report ${error.message}`
    });

  }
};
export const getMyInterviews = async (req, res) => {
  try {

    const interviews = await Interview
      .find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .select("role experience mode finalScore status createdAt");

    res.json(interviews);

  } catch (error) {

    return res.status(500).json({
      message: `failed to fetch interviews ${error.message}`
    });

  }
};