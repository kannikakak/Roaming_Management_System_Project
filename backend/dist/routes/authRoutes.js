"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = void 0;
const express_1 = require("express");
const authController_1 = require("../controllers/authController");
const authRoutes = (dbPool) => {
    const router = (0, express_1.Router)();
    router.post('/register', (0, authController_1.register)(dbPool));
    router.post('/login', (0, authController_1.login)(dbPool));
    return router;
};
exports.authRoutes = authRoutes;
