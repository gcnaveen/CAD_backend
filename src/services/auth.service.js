/**
 * Authentication Service
 * Super Admin/Admin/CAD: email + password login.
 * Surveyor: phone + password login (OTP only during first-time registration).
 */

const User = require("../models/user/User");
const { generateToken } = require("../middleware/auth.middleware");
const otpService = require("./otp.service");
const { USER_ROLES, USER_STATUS } = require("../config/constants");
const {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} = require("../utils/errors");

/** Roles that use email + password login */
const EMAIL_PASSWORD_ROLES = [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.CAD];

/** Role that uses phone + password login (OTP only for registration) */
const SURVEYOR_ROLE = USER_ROLES.SURVEYOR;

class AuthService {
  /**
   * Returns true if at least one Super Admin exists (used to protect registration).
   */
  async hasSuperAdmin() {
    const count = await User.countDocuments({ role: USER_ROLES.SUPER_ADMIN });
    return count > 0;
  }

  /**
   * Register new Super Admin.
   * Password role → create as ACTIVE, return user + token.
   */
  async registerSuperAdmin(payload) {
    const { firstName, lastName, email, password } = payload;

    if (!email || !password || !firstName) {
      throw new BadRequestError("firstName, email and password are required");
    }

    const existing = await User.findOne({ "auth.email": email.toLowerCase().trim() });
    if (existing) {
      throw new ConflictError("Email already registered");
    }

    const user = await User.create({
      role: USER_ROLES.SUPER_ADMIN,
      name: { first: firstName.trim(), last: (lastName || "").trim() },
      auth: {
        email: email.toLowerCase().trim(),
        password,
      },
      createdBy: null,
    });

    const token = generateToken(user);
    return {
      user,
      token,
      otpRequired: false,
      message: "Registration successful",
    };
  }

  /**
   * Surveyor step 1: create/find user by phone + name, send OTP.
   * Returns otpRequired: true (verify next to get token).
   */
  async surveyorSendOtp(payload) {
    const { phone, firstName, lastName } = payload;

    if (!phone || !firstName) {
      throw new BadRequestError("phone and firstName are required");
    }

    const normalizedPhone = String(phone).trim();
    let user = await User.findOne({ "auth.phone": normalizedPhone }).select(
      "+auth.otpCode +auth.otpExpires"
    );

    if (!user) {
      try {
        user = await User.create({
          role: USER_ROLES.SURVEYOR,
          name: { first: firstName.trim(), last: (lastName || "").trim() },
          auth: { phone: normalizedPhone },
        });
        // Reload with OTP fields selected
        user = await User.findById(user._id).select("+auth.otpCode +auth.otpExpires");
      } catch (err) {
        // If user creation fails (e.g., duplicate phone), try to find again
        if (err.code === 11000 || err.name === 'MongoServerError') {
          user = await User.findOne({ "auth.phone": normalizedPhone }).select(
            "+auth.otpCode +auth.otpExpires"
          );
          if (!user) {
            throw new DatabaseError("Failed to create user", err);
          }
        } else {
          throw err;
        }
      }
    } else {
      if (user.role !== USER_ROLES.SURVEYOR) {
        throw new ConflictError("This phone is registered with a different role");
      }
      user.name.first = firstName.trim();
      user.name.last = (lastName || "").trim();
      await user.save();
    }

    // Ensure user is saved before issuing OTP
    if (!user._id) {
      throw new DatabaseError("User not properly saved");
    }

    // Pass the user instance to avoid re-querying (now with OTP fields selected)
    const result = await otpService.issueOtp(normalizedPhone, user);
    return {
      message: result.message,
      expiresAt: result.expiresAt,
      otpRequired: true,
    };
  }

  /**
   * Surveyor step 2: verify OTP during registration. Marks user as verified.
   * Returns message indicating next step (complete registration).
   */
  async surveyorVerifyOtp(payload) {
    const { phone, otp } = payload;

    if (!phone || !otp) {
      throw new BadRequestError("phone and otp are required");
    }

    const user = await otpService.verifyOtp(String(phone).trim(), String(otp).trim());

    if (user.role !== USER_ROLES.SURVEYOR) {
      throw new BadRequestError("User is not a surveyor");
    }

    if (user.status !== USER_STATUS.ACTIVE) {
      user.status = USER_STATUS.ACTIVE;
      await user.save();
    }

    return {
      user,
      message: "OTP verified. Please complete registration with password and profile details.",
    };
  }

  /**
   * Surveyor step 3: complete registration - set password and profile in one call.
   * Requires OTP to be verified first. Returns user + token.
   */
  async surveyorCompleteRegistration(payload) {
    const { phone, password, district, taluka, category, surveyType, firstName, lastName } = payload;

    if (!phone || !password) {
      throw new BadRequestError("phone and password are required");
    }

    if (!district || !taluka || !category) {
      throw new BadRequestError("district, taluka and category are required");
    }

    if (category === "SURVEYOR" && !surveyType) {
      throw new BadRequestError("surveyType (LS or GS) is required when category is SURVEYOR");
    }

    const normalizedPhone = String(phone).trim();
    const user = await User.findOne({ "auth.phone": normalizedPhone }).select("+auth.password");

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (user.role !== USER_ROLES.SURVEYOR) {
      throw new BadRequestError("User is not a surveyor");
    }

    if (!user.auth?.otpVerified) {
      throw new ForbiddenError("Complete OTP verification before completing registration");
    }

    if (user.auth.password) {
      throw new ConflictError("Registration already completed. Use login instead.");
    }

    // Update name if provided in payload
    if (firstName) {
      user.name.first = firstName.trim();
    }
    if (lastName !== undefined) {
      user.name.last = lastName ? lastName.trim() : "";
    }

    // Set password
    user.auth.password = password;

    // Set profile
    user.surveyorProfile = {
      district,
      taluka,
      category,
      surveyType: category === "SURVEYOR" ? surveyType : undefined,
    };

    await user.save();

    const token = generateToken(user);
    return {
      user,
      token,
      message: "Registration completed successfully.",
    };
  }

  /**
   * Login: email + password (Super Admin / Admin / CAD) OR phone + password (Surveyor).
   * Returns user + token.
   */
  async login(payload) {
    const { email, phone, password } = payload;

    if (!password) {
      throw new BadRequestError("password is required");
    }

    if (!email && !phone) {
      throw new BadRequestError("email or phone is required");
    }

    let user;

    if (email) {
      // Email + password login (Super Admin / Admin / CAD)
      user = await User.findOne({ "auth.email": email.toLowerCase().trim() }).select(
        "+auth.password"
      );

      if (!user) {
        throw new UnauthorizedError("Invalid credentials");
      }

      if (!EMAIL_PASSWORD_ROLES.includes(user.role)) {
        throw new BadRequestError(
          "This account uses phone + password login. Use phone number and password to sign in."
        );
      }
    } else {
      // Phone + password login (Surveyor)
      const normalizedPhone = String(phone).trim();
      user = await User.findOne({ "auth.phone": normalizedPhone }).select("+auth.password");

      if (!user) {
        throw new UnauthorizedError("Invalid credentials");
      }

      if (user.role !== SURVEYOR_ROLE) {
        throw new BadRequestError(
          "This account uses email + password login. Use email and password to sign in."
        );
      }

      if (!user.auth.password) {
        throw new BadRequestError(
          "Password not set. Complete registration by setting your password."
        );
      }
    }

    const match = await user.comparePassword(password);
    if (!match) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const token = generateToken(user);
    return {
      user,
      token,
      otpRequired: false,
      message: "Login successful",
    };
  }

  /**
   * Resend OTP during surveyor registration. Only for users without password set.
   */
  async resendSurveyorOtp(phone) {
    const normalizedPhone = String(phone).trim();
    const user = await User.findOne({ "auth.phone": normalizedPhone }).select("+auth.password");

    if (!user) {
      throw new UnauthorizedError("No user found with this phone number");
    }

    if (user.role !== SURVEYOR_ROLE) {
      throw new BadRequestError(
        "This account uses email + password login. Use email and password to sign in."
      );
    }

    if (user.auth.password) {
      throw new BadRequestError(
        "Password already set. Use phone and password to login instead."
      );
    }

    return otpService.issueOtp(normalizedPhone);
  }
}

module.exports = new AuthService();
