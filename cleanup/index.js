import functions from "@google-cloud/functions-framework";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// Initialize Firebase Admin
initializeApp({
  storageBucket: process.env.STORAGE_BUCKET,
});

const db = getFirestore();
const bucket = getStorage().bucket();

/**
 * 6개월(179일) 경과한 상담 데이터 자동 삭제
 * Cloud Scheduler가 매일 자정에 호출
 */
functions.http("deleteOldInquiries", async (req, res) => {
  const startTime = Date.now();

  try {
    const now = new Date();
    console.log(`[삭제 작업 시작] 실행 시간: ${now.toISOString()}`);

    // deleteAt < 오늘 조건으로 삭제 대상 조회
    const snapshot = await db
      .collection("inquiries")
      .where("deleteAt", "<", now)
      .limit(500) // 한 번에 최대 500개 (안전장치)
      .get();

    if (snapshot.empty) {
      console.log("삭제할 문서 없음");
      return res.json({
        status: "success",
        deletedCount: 0,
        message: "삭제할 문서 없음",
        executionTime: Date.now() - startTime,
      });
    }

    let deletedDocs = 0;
    let deletedFiles = 0;
    const errors = [];

    // 각 문서 처리
    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();
        const docId = doc.id;

        // 첨부파일 삭제
        if (Array.isArray(data.attachments) && data.attachments.length > 0) {
          for (const attachment of data.attachments) {
            const filePath = attachment.path || attachment.filename;
            if (filePath) {
              try {
                await bucket.file(filePath).delete();
                deletedFiles++;
                console.log(`파일 삭제: ${filePath}`);
              } catch (fileErr) {
                // 파일이 이미 없으면 무시 (404 에러)
                if (fileErr.code !== 404) {
                  console.error(`파일 삭제 실패 [${filePath}]:`, fileErr.message);
                  errors.push({
                    type: "file",
                    path: filePath,
                    error: fileErr.message,
                  });
                }
              }
            }
          }
        }

        // Firestore 문서 삭제
        await doc.ref.delete();
        deletedDocs++;
        console.log(`문서 삭제: ${docId} (생성일: ${data.createdAt?.toDate?.()?.toISOString() || "unknown"})`);

      } catch (docErr) {
        console.error(`문서 처리 실패 [${doc.id}]:`, docErr.message);
        errors.push({
          type: "document",
          docId: doc.id,
          error: docErr.message,
        });
      }
    }

    const executionTime = Date.now() - startTime;

    console.log(`[삭제 작업 완료]`);
    console.log(`- 삭제된 문서: ${deletedDocs}개`);
    console.log(`- 삭제된 파일: ${deletedFiles}개`);
    console.log(`- 실행 시간: ${executionTime}ms`);
    if (errors.length > 0) {
      console.warn(`- 오류 발생: ${errors.length}건`, errors);
    }

    res.json({
      status: "success",
      deletedDocs,
      deletedFiles,
      errors: errors.length > 0 ? errors : undefined,
      executionTime,
      timestamp: now.toISOString(),
    });

  } catch (err) {
    console.error("삭제 작업 실패:", err);
    res.status(500).json({
      status: "error",
      message: err.message,
      executionTime: Date.now() - startTime,
    });
  }
});
