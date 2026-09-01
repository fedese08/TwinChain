import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";

export async function GET() {
  try {
    const mongoose = await connectToDatabase();
    return NextResponse.json({
      status: "ok",
      db: mongoose.connection.readyState === 1 ? "connected" : "not-ready",
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "unknown error" },
      { status: 500 },
    );
  }
}
