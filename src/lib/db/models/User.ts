import { Schema, model, models, type Document } from "mongoose";
import type { User } from "@/lib/validators/user";

export interface UserDocument extends Document, User {
  passwordHash?: string;
  createdAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    image: { type: String },
    passwordHash: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const UserModel = models.User ?? model<UserDocument>("User", userSchema);
