require("dotenv").config();
import { NextFunction, Request, Response } from "express";
import twilio from "twilio";
import prisma from "../utils/prisma";
import jwt from "jsonwebtoken";
import { sendToken } from "../utils/send-token";
import { nylas } from "../app";
import { razorpay } from "../utils/razorpay";
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken, {
  lazyLoading: true,
});
export const getDriverForSocket = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const driver = await prisma.driver.findUnique({
      where: { id },
      select: {
        id: true,
        wallet: true,
        status: true,
        vehicle_type: true,
        rate: true,
        pushToken: true,
        isBlocked: true,
      },
    });

    if (!driver  || driver.isBlocked) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
};

export const saveDriverPushToken = async (req: any, res: Response) => {
  try {
    const { pushToken } = req.body;

    if (!pushToken)
      return res.status(400).json({ success: false, message: "Token missing" });

    await prisma.driver.update({
      where: { id: req.driver.id },
      data: { pushToken },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.log("PUSH TOKEN ERROR:", error);
    res.status(500).json({ success: false });
  }
};
// /controllers/walletController.ts
export const topUpWallet = async (req: Request, res: Response) => {
  try {
    const { driverId, amount } = req.body;

    if (!driverId || !amount) {
      return res.status(400).json({
        success: false,
        message: "Driver ID and amount are required",
      });
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { wallet: true, isBlocked: true },
    });

    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }

    const updated = await prisma.driver.update({
      where: { id: driverId },
      data: {
        wallet: parseFloat(amount) + (driver.wallet || 0), // 👈 manual top-up
        isBlocked: false, // auto-unblock
        warningCount: 0,
      },
      select: {
        wallet: true,
        isBlocked: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Wallet topped up successfully",
      wallet: updated.wallet,
      isBlocked: updated.isBlocked,
    });
  } catch (error) {
    console.error("Top-up error:", error);
    res.status(500).json({
      success: false,
      message: "Top-up failed",
    });
  }
};


export const completeRideAndDeductWallet = async (
  req: Request,
  res: Response
) => {
  try {
    const { driverId, rate, distance } = req.body;

    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: "Driver not found" });
    }

    const rideCount = await prisma.rides.count({ where: { driverId } });
    const totalFare = rate * distance;
    const deduction = rideCount <= 1 ? 0 : totalFare * 0.2;

    const updatedDriver = await prisma.driver.update({
      where: { id: driverId },
      data: {
        wallet: { decrement: deduction },
      },
    });
    let warningSent = "";

if (updatedDriver.wallet < -50 && updatedDriver.wallet > -300) {
  if (driver.warningCount < 3) {
    await prisma.driver.update({
      where: { id: driverId },
      data: {
        warningCount: { increment: 1 },
      },
    });

    // ✅ Re-fetch updated driver after increment
    const newDriver = await prisma.driver.findUnique({
      where: { id: driverId },
    });

    const newWarningCount = newDriver?.warningCount || driver.warningCount + 1;

    await nylas.messages.send({
      identifier: process.env.USER_GRANT_ID!,
      requestBody: {
        to: [{ name: driver.name, email: driver.email }],
        subject: `⚠️ AmbuRide Wallet Warning #${newWarningCount}`,
        body: `
          <p>Hi ${driver.name},</p>
          <p>⚠️ This is warning #${newWarningCount}. Your wallet balance is ₹${updatedDriver.wallet}.</p>
          <p>Please top-up your wallet soon to avoid getting blocked.</p>
          <p>Regards,<br>AmbuRide Team</p>
        `,
      },
    });

    warningSent = `Warning #${newWarningCount} sent via email.`;
  }
}

    // Blocking logic
    if (updatedDriver.wallet <= -300 && !driver.isBlocked) {
      await prisma.driver.update({
        where: { id: driverId },
        data: { isBlocked: true },
      });

      await nylas.messages.send({
        identifier: process.env.USER_GRANT_ID!,
        requestBody: {
          to: [{ name: driver.name, email: driver.email }],
          subject: "🚫 Driver Blocked - AmbuRide",
          body: `
            <p>Hi ${driver.name},</p>
            <p>Your wallet balance has dropped below ₹-300. You are now temporarily <strong>blocked</strong> from accepting rides.</p>
            <p>Please top-up your wallet to be unblocked automatically.</p>
            <p>Regards,<br>AmbuRide Team</p>
          `,
        },
      });

      warningSent = "Driver blocked and email sent.";
    }

    return res.status(200).json({
      success: true,
      wallet: updatedDriver.wallet,
      isBlocked: updatedDriver.wallet <= -300,
      message: warningSent || "Ride completed.",
    });
  } catch (error) {
    console.error("Ride error:", error);
    res
      .status(500)
      .json({ success: false, message: "Ride completion failed" });
  }
};
export const creditDriverWallet = async (req: Request, res: Response) => {
  try {
    const { driverId, amount } = req.body;

    if (!driverId || !amount) {
      return res.status(400).json({
        success: false,
        message: "Driver ID and amount are required",
      });
    }

    const updatedDriver = await prisma.driver.update({
      where: { id: driverId },
      data: {
        wallet: {
          increment: parseFloat(amount),
        },
      },
    });

    res.status(200).json({
      success: true,
      message: "Wallet top-up successful",
      wallet: updatedDriver.wallet,
    });
  } catch (error: any) {
    console.error("Wallet update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update wallet",
    });
  }
};
export const createRazorpayOrder = async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        message: "Amount is required",
      });
    }

    const order = await razorpay.orders.create({
      amount: parseInt(amount) * 100, // amount in paise
      currency: "INR",
      receipt: `wallet_topup_${Date.now()}`,
    });

    res.status(201).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error: any) {
    console.error("Razorpay order creation failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create Razorpay order",
    });
  }
};
// sending otp to driver phone number
export const sendingOtpToPhone = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { phone_number } = req.body;
    console.log(phone_number);
    try {
      await client.verify.v2
        ?.services(process.env.TWILIO_SERVICE_SID!)
        .verifications.create({
          channel: "sms",
          to: phone_number,
        });

      res.status(201).json({
        success: true,
      });
    } catch (error) {
      console.log(error);
      res.status(400).json({
        success: false,
      });
    }
  } catch (error) {
    console.log(error);
    res.status(400).json({
      success: false,
    });
  }
};

// verifying otp for login
export const verifyPhoneOtpForLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { phone_number, otp } = req.body;

    try {
      await client.verify.v2
        .services(process.env.TWILIO_SERVICE_SID!)
        .verificationChecks.create({
          to: phone_number,
          code: otp,
        });

      const driver = await prisma.driver.findUnique({
        where: {
          phone_number,
        },
      });
      sendToken(driver, res);
    } catch (error) {
      console.log(error);
      res.status(400).json({
        success: false,
        message: "Something went wrong!",
      });
    }
  } catch (error) {
    console.log(error);
    res.status(400).json({
      success: false,
    });
  }
};

// verifying phone otp for registration
export const verifyPhoneOtpForRegistration = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { phone_number, otp } = req.body;

    try {
      await client.verify.v2
        .services(process.env.TWILIO_SERVICE_SID!)
        .verificationChecks.create({
          to: phone_number,
          code: otp,
        });

      //await sendingOtpToEmail(req, res);
    } catch (error) {
      console.log(error);
      res.status(400).json({
        success: false,
        message: "Something went wrong!",
      });
    }
  } catch (error) {
    console.log(error);
    res.status(400).json({
      success: false,
    });
  }
};

// sending otp to email
export const sendingOtpToEmail = async (req: Request, res: Response) => {
  try {
    const {
      name,
      country,
      phone_number,
      email,
      vehicle_type,
      registration_number,
      registration_date,
      driving_license,
      vehicle_color,
      rate,
    } = req.body;

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    const driver = {
      name,
      country,
      phone_number,
      email,
      vehicle_type,
      registration_number,
      registration_date,
      driving_license,
      vehicle_color,
      rate,
    };
    const token = jwt.sign(
      {
        driver,
        otp,
      },
      process.env.EMAIL_ACTIVATION_SECRET!,
      {
        expiresIn: "5m",
      }
    );
    try {
      await nylas.messages.send({
        identifier: process.env.USER_GRANT_ID!,
        requestBody: {
          to: [{ name: name, email: email }],
          subject: "Verify your email address!",
          body: `
          <p>Hi ${name},</p>
      <p>Your Ambu Ride Driver verification code is ${otp}. If you didn't request for this OTP, please ignore this email!</p>
      <p>Thanks,<br>AmbuRide Driver Team </p>
            `,
        },
      });
      res.status(201).json({
        success: true,
        token,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      console.log(error);
    }
  } catch (error) {
    console.log(error);
  }
};

// verifying email otp and creating driver account
export const verifyingEmailOtp = async (req: Request, res: Response) => {
  try {
    const { otp, token } = req.body;

    const newDriver: any = jwt.verify(
      token,
      process.env.EMAIL_ACTIVATION_SECRET!
    );

    if (newDriver.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "OTP is not correct or expired!",
      });
    }

    const {
      name,
      country,
      phone_number,
      email,
      vehicle_type,
      registration_number,
      registration_date,
      driving_license,
      vehicle_color,
      rate,
    } = newDriver.driver;

    const driver = await prisma.driver.create({
      data: {
        name,
        country,
        phone_number,
        email,
        vehicle_type,
        registration_number,
        registration_date,
        driving_license,
        vehicle_color,
        rate,
      },
    });
    sendToken(driver, res);
  } catch (error) {
    console.log(error);
    res.status(400).json({
      success: false,
      message: "Your otp is expired!",
    });
  }
};

// get logged in driver data
export const getLoggedInDriverData = async (req: any, res: Response) => {
  try {
    const driver = req.driver;

    res.status(201).json({
      success: true,
      driver,
    });
  } catch (error) {
    console.log(error);
  }
};

// updating driver status
export const updateDriverStatus = async (req: any, res: Response) => {
  try {
    const { status } = req.body;

    const driver = await prisma.driver.update({
      where: {
        id: req.driver.id!,
      },
      data: {
        status,
      },
    });
    res.status(201).json({
      success: true,
      driver,
    });
  } catch (error: any) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// get drivers data with id
export const getDriversById = async (req: Request, res: Response) => {
  try {
    const { ids } = req.query as any;
    console.log(ids,'ids')
    if (!ids) {
      return res.status(400).json({ message: "No driver IDs provided" });
    }

    const driverIds = ids.split(",");

    // Fetch drivers from database
    const drivers = await prisma.driver.findMany({
      where: {
        id: { in: driverIds },
      },
    });

    res.json(drivers);
  } catch (error) {
    console.error("Error fetching driver data:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
// const getDistanceKm = (
//   lat1: number,
//   lon1: number,
//   lat2: number,
//   lon2: number
// ) => {
//   const R = 6371;
//   const dLat = ((lat2 - lat1) * Math.PI) / 180;
//   const dLon = ((lon2 - lon1) * Math.PI) / 180;

//   const a =
//     Math.sin(dLat / 2) ** 2 +
//     Math.cos((lat1 * Math.PI) / 180) *
//       Math.cos((lat2 * Math.PI) / 180) *
//       Math.sin(dLon / 2) ** 2;

//   return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
// };

// export const getDriversById = async (req: Request, res: Response) => {
//   try {
//     const { ids, vehicleType, userLat, userLng } = req.query as any;

//     if (!ids || !vehicleType || !userLat || !userLng) {
//       return res.status(400).json({ message: "Missing params" });
//     }

//     const driverIds = ids.split(",");

//     // 1️⃣ Fetch drivers
//     const drivers = await prisma.driver.findMany({
//       where: {
//         id: { in: driverIds },
//         vehicle_type: vehicleType,
//         wallet: { gt: 1 },
//         status: "active",
//       },
//       select: {
//         id: true,
//         name: true,
//         latitude: true,
//         longitude: true,
//         vehicle_type: true,
//         rate: true,
//         pushToken: true,
//       },
//     });

//     // 2️⃣ Fetch latest rides in ONE query
//     const latestRides = await prisma.rides.findMany({
//       where: { driverId: { in: driverIds } },
//       orderBy: { createdAt: "desc" },
//       distinct: ["driverId"],
//       select: {
//         driverId: true,
//         status: true,
//       },
//     });

//     const rideStatusMap = new Map(
//       latestRides.map(r => [r.driverId, r.status])
//     );

//     // 3️⃣ Filter drivers
//     const eligibleDrivers = drivers.filter(driver => {
//       const rideStatus = rideStatusMap.get(driver.id);

//       // busy driver
//       if (rideStatus && rideStatus !== "Completed") return false;

//       if (!driver.latitude || !driver.longitude) return false;

//       const distance = getDistanceKm(
//         Number(userLat),
//         Number(userLng),
//         driver.latitude,
//         driver.longitude
//       );

//       return distance <= 5;
//     });

//     res.json(eligibleDrivers);
//   } catch (error) {
//     console.error("Driver filter error:", error);
//     res.status(500).json({ message: "Internal server error" });
//   }
// };


// creating new ride
export const newRide = async (req: any, res: Response) => {
  try {
    const {
      userId,
      charge,
      status,
      currentLocationName,
      destinationLocationName,
      distance,
    } = req.body;

    const newRide = await prisma.rides.create({
      data: {
        userId,
        driverId: req.driver.id,
        charge: parseFloat(charge),
        status,
        currentLocationName,
        destinationLocationName,
        distance,
      },
    });
    res.status(201).json({ success: true, newRide });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// updating ride status
export const updatingRideStatus = async (req: any, res: Response) => {
  try {
    const { rideId, rideStatus } = req.body;

    // Validate input
    if (!rideId || !rideStatus) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid input data" });
    }

    const driverId = req.driver?.id;
    if (!driverId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Fetch the ride data to get the rideCharge
    const ride = await prisma.rides.findUnique({
      where: {
        id: rideId,
      },
    });

    if (!ride) {
      return res
        .status(404)
        .json({ success: false, message: "Ride not found" });
    }

    const rideCharge = ride.charge;

    // Update ride status
    const updatedRide = await prisma.rides.update({
      where: {
        id: rideId,
        driverId,
      },
      data: {
        status: rideStatus,
      },
    });

    if (rideStatus === "Completed") {
      // Update driver stats if the ride is completed
      await prisma.driver.update({
        where: {
          id: driverId,
        },
        data: {
          totalEarning: {
            increment: rideCharge,
          },
          totalRides: {
            increment: 1,
          },
        },
      });
    }

    res.status(201).json({
      success: true,
      updatedRide,
    });
  } catch (error: any) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// getting drivers rides
export const getAllRides = async (req: any, res: Response) => {
  const rides = await prisma.rides.findMany({
    where: {
      driverId: req.driver?.id,
    },
    include: {
      driver: true,
      user: true,
    },
  });
  res.status(201).json({
    rides,
  });
};
export const getAllDrivers = async (req: Request, res: Response) => {
  try {
    const drivers = await prisma.driver.findMany();
    res.status(200).json({ drivers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch drivers' });
  }
};
export const getallRides = async (req: Request, res: Response) => {
  try {
    const rides = await prisma.rides.findMany({
      include: {
        user: true,
        driver: true,
      },
    });
    res.status(200).json({
      totalRides: rides.length,
      rides,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rides' });
  }
};
export const logoutDriver = async (req: any, res: Response) => {
  try {
    const driverId = req.driver?.id;

    if (!driverId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Set driver's status to "Inactive"
    await prisma.driver.update({
      where: {
        id: driverId,
      },
      data: {
        status: "Inactive",
      },
    });

    // Optionally, remove any server-side session/token handling if implemented

    res.status(200).json({
      success: true,
      message: "Driver logged out and status set to Inactive",
    });
  } catch (error: any) {
    console.error("Logout error:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};




