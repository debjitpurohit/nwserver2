import express from "express";
import {
  getAllRides,
  getAllUsers,
  getLoggedInUserData,
  registerUser,
  sendingOtpToEmail,
  verifyingEmail,
  verifyOtp,
  saveUserPushToken
} from "../controllers/user.controller";
import { isAuthenticated } from "../middleware/isAuthenticated";

const userRouter = express.Router();

userRouter.post("/registration", registerUser);

userRouter.post("/verify-otp", verifyOtp);

userRouter.post("/email-otp-request", sendingOtpToEmail);

userRouter.put("/email-otp-verify", verifyingEmail);

userRouter.get("/me", isAuthenticated, getLoggedInUserData);

userRouter.get("/get-rides", isAuthenticated, getAllRides);
userRouter.get("/users",getAllUsers);
userRouter.post("/push-token", isAuthenticated, saveUserPushToken);
export default userRouter;
