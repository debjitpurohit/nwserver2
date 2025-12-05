import express from "express";
import {
  getAllDrivers,
  getallRides,
  getAllRides,
  getDriversById,
  getLoggedInDriverData,
  newRide,
  sendingOtpToPhone,
  updateDriverStatus,
  updatingRideStatus,
  verifyingEmailOtp,
  verifyPhoneOtpForLogin,
  verifyPhoneOtpForRegistration,
  logoutDriver,
  createRazorpayOrder,
  creditDriverWallet,
  topUpWallet,
  completeRideAndDeductWallet,
  saveDriverPushToken
} from "../controllers/driver.controller";
import { isAuthenticatedDriver } from "../middleware/isAuthenticated";


const driverRouter = express.Router();

driverRouter.post("/send-otp", sendingOtpToPhone);

driverRouter.post("/login", verifyPhoneOtpForLogin);

driverRouter.post("/verify-otp", verifyPhoneOtpForRegistration);

driverRouter.post("/registration-driver", verifyingEmailOtp);

driverRouter.get("/me", isAuthenticatedDriver, getLoggedInDriverData);

driverRouter.get("/get-drivers-data", getDriversById);

driverRouter.put("/update-status", isAuthenticatedDriver, updateDriverStatus);

driverRouter.post("/new-ride", isAuthenticatedDriver, newRide);

driverRouter.put(
  "/update-ride-status",
  isAuthenticatedDriver,
  updatingRideStatus
);
driverRouter.post("/create-order", createRazorpayOrder);
driverRouter.post("/credit",creditDriverWallet)
driverRouter.post("/wallet/topup", topUpWallet);
driverRouter.post("/ride/complete", completeRideAndDeductWallet);

driverRouter.get("/get-rides", isAuthenticatedDriver, getAllRides);
driverRouter.get("/driversdetail",getAllDrivers);
driverRouter.get("/ridesall", getallRides);
driverRouter.get("/update-status",isAuthenticatedDriver, logoutDriver)
driverRouter.post("/push-token", isAuthenticatedDriver, saveDriverPushToken);

export default driverRouter;
